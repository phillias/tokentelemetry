"""Contract tests for the /sessions list feed.

Covers the slim ``?view=summary`` projection (the fields the polling list
pages render) and the stale-while-revalidate cache behaviour that keeps the
feed sub-second while a slow — or wedged — scan runs.
"""

import asyncio
import os
import sys
import threading
import time

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(__file__))
import main  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def _row(sid, **extra):
    row = {
        "id": sid,
        "agent": "claude",
        "project": "/workspace/app",
        "timestamp": "2026-10-01T12:00:00+00:00",
        "display": "Do things",
        "text": "Do things",
        "tokens": {"input": 1, "output": 2, "cached": 0, "total": 3},
        "cost": 0.01,
        "model": "claude-sonnet-4-6",
        "provider": "anthropic",
        "parent_session_id": None,
        # Detail-only / heavy fields the summary must drop.
        "plans": [{"kind": "trace", "steps": [1, 2, 3]}],
        "artifacts": [{"name": "notes.md", "path": "/tmp/notes.md", "type": "document"}],
        "mcp_tools": ["fetch"],
        "has_plan": True,
        "models_used": ["claude-sonnet-4-6"],
        "outcome_raw": "done",
        "loop": {"is_loop": False},
        "stub": True,
    }
    row.update(extra)
    return row


@pytest.fixture
def feed_env(monkeypatch):
    """Isolate the sessions cache: fake scanner, silenced side effects."""
    monkeypatch.setattr(main, "_sessions_lock", None)
    monkeypatch.setattr(main, "_report_harness_scan", lambda data: None)
    monkeypatch.setattr(main, "_persist_history_async", lambda data: None)
    main._sessions_cache.update(
        {
            "data": None,
            "at": 0.0,
            "building": False,
            "build_started": 0.0,
            "last_error": None,
        }
    )
    yield main
    main._sessions_lock = None
    main._sessions_cache.update(
        {
            "data": None,
            "at": 0.0,
            "building": False,
            "build_started": 0.0,
            "last_error": None,
        }
    )


def _fake_scan(monkeypatch, rows):
    calls = []

    def scan():
        calls.append(1)
        return [dict(r) for r in rows]

    monkeypatch.setattr(main, "_scan_sessions_sync", scan)
    return calls


# --- summary projection -----------------------------------------------------


def test_summary_view_keeps_only_list_fields(feed_env):
    view = feed_env._session_summary_view(_row("s1"))
    assert set(view) == {
        "id", "agent", "project", "timestamp", "display", "text",
        "tokens", "cost", "model", "provider", "parent_session_id",
    }
    assert view["tokens"] == {"input": 1, "output": 2, "cached": 0, "total": 3}
    for dropped in (
        "plans", "artifacts", "mcp_tools", "has_plan", "models_used",
        "outcome_raw", "loop", "stub",
    ):
        assert dropped not in view


def test_summary_view_tolerates_missing_optional_fields(feed_env):
    sparse = {"id": "s9", "agent": "pi", "timestamp": "2026-10-01T00:00:00+00:00"}
    assert feed_env._session_summary_view(sparse) == sparse


def test_get_sessions_summary_matches_full_ids(feed_env, monkeypatch):
    rows = [_row("s1"), _row("s2", agent="codex")]

    async def fake_cached(fresh=False):
        return rows

    monkeypatch.setattr(feed_env, "get_sessions_cached", fake_cached)
    full = _run(feed_env.get_sessions())
    slim = _run(feed_env.get_sessions(view="summary"))
    assert [s["id"] for s in slim] == [s["id"] for s in full] == ["s1", "s2"]
    assert all("plans" in s for s in full)
    assert all("stub" not in s for s in full)
    assert all("plans" not in s and "stub" not in s for s in slim)
    assert slim[0]["tokens"]["total"] == 3


def test_get_sessions_rejects_unknown_view(feed_env):
    with pytest.raises(HTTPException) as exc:
        _run(feed_env.get_sessions(view="everything"))
    assert exc.value.status_code == 422


# --- stale-while-revalidate --------------------------------------------------


def _prime(feed_env, rows, age_sec):
    feed_env._sessions_cache.update(
        {"data": [dict(r) for r in rows], "at": time.monotonic() - age_sec}
    )


def test_cold_cache_waits_for_scan(feed_env, monkeypatch):
    calls = _fake_scan(monkeypatch, [_row("fresh")])
    assert [s["id"] for s in _run(feed_env.get_sessions_cached())] == ["fresh"]
    assert calls == [1]


def test_fresh_ttl_hit_serves_cache_without_scan(feed_env, monkeypatch):
    _prime(feed_env, [_row("cached")], age_sec=5)
    calls = _fake_scan(monkeypatch, [_row("new")])
    assert [s["id"] for s in _run(feed_env.get_sessions_cached())] == ["cached"]
    assert calls == []


def test_stale_served_immediately_during_slow_scan(feed_env, monkeypatch):
    gate = threading.Event()
    released = []

    def slow_scan():
        assert gate.wait(timeout=30)
        released.append(1)
        return [_row("new")]

    monkeypatch.setattr(feed_env, "_scan_sessions_sync", slow_scan)
    _prime(feed_env, [_row("stale")], age_sec=3600)

    async def scenario():
        # The stale snapshot must come back at once, not after the scan.
        got = await asyncio.wait_for(feed_env.get_sessions_cached(), timeout=5)
        assert [s["id"] for s in got] == ["stale"]
        assert feed_env._sessions_cache["building"] is True
        gate.set()
        for _ in range(200):
            if released and feed_env._sessions_cache["building"] is False:
                break
            await asyncio.sleep(0.05)
        return [s["id"] for s in feed_env._sessions_cache["data"]]

    assert _run(scenario()) == ["new"]


def test_stuck_build_triggers_replacement(feed_env, monkeypatch):
    calls = _fake_scan(monkeypatch, [_row("replacement")])
    _prime(feed_env, [_row("stale")], age_sec=3600)
    feed_env._sessions_cache.update(
        {"building": True, "build_started": time.monotonic() - 3600}
    )

    async def scenario():
        got = await asyncio.wait_for(feed_env.get_sessions_cached(), timeout=5)
        assert [s["id"] for s in got] == ["stale"]
        for _ in range(200):
            cache = feed_env._sessions_cache
            if calls and cache["building"] is False:
                return [s["id"] for s in cache["data"]]
            await asyncio.sleep(0.05)
        raise AssertionError("replacement scan never published")

    assert _run(scenario()) == ["replacement"]
    assert calls == [1]


def test_failed_scan_serves_stale_and_records_error(feed_env, monkeypatch):
    def bad_scan():
        raise RuntimeError("disk went away")

    monkeypatch.setattr(feed_env, "_scan_sessions_sync", bad_scan)
    _prime(feed_env, [_row("stale")], age_sec=3600)

    async def scenario():
        got = await asyncio.wait_for(feed_env.get_sessions_cached(), timeout=5)
        assert [s["id"] for s in got] == ["stale"]
        for _ in range(200):
            cache = feed_env._sessions_cache
            if cache["building"] is False and cache["last_error"] is not None:
                return cache["last_error"]
            await asyncio.sleep(0.05)
        raise AssertionError("scan error never recorded")

    assert "disk went away" in _run(scenario())


def test_fresh_forces_rescan(feed_env, monkeypatch):
    _prime(feed_env, [_row("cached")], age_sec=5)
    calls = _fake_scan(monkeypatch, [_row("rescanned")])
    got = _run(feed_env.get_sessions_cached(fresh=True))
    assert [s["id"] for s in got] == ["rescanned"]
    assert calls == [1]
