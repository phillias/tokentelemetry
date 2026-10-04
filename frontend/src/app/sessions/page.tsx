"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { format } from "date-fns";
import { History, Search } from "lucide-react";

import { useResource } from "@/lib/api";
import { SESSIONS_SUMMARY_PATH, SESSIONS_LIST_POLL_MS } from "@/lib/sessionsFeed";
import { getAgent } from "@/lib/agents";
import { AgentLogo } from "@/components/icons/AgentLogo";
import { projectBasename } from "@/lib/paths";
import { formatTokens, formatCost } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  PageHeader, StatTile, Section, Card,
  Table, THead, TBody, TR, TH, TD, AgentBadge, EmptyState, Skeleton,
} from "@/components/ui";

interface Session {
  id: string;
  agent: string;
  project: string;
  timestamp: string;
  display?: string;
  text?: string;
  tokens?: { input: number; output: number; cached: number; total: number };
  cost?: number;
}

function sessionTime(iso: string): { time: string; day: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { time: "—", day: "" };
  return { time: format(d, "HH:mm:ss"), day: format(d, "MMM d") };
}

export default function SessionsPage() {
  const pathname = usePathname();
  const { data, loading } = useResource<Session[]>(SESSIONS_SUMMARY_PATH, { pollMs: SESSIONS_LIST_POLL_MS, initial: [] });
  const [query, setQuery] = useState("");
  const [selAgents, setSelAgents] = useState<string[]>([]);

  const sessions = useMemo(
    () => [...(data ?? [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [data],
  );
  const agentOptions = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.agent))).sort(),
    [sessions],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (selAgents.length > 0 && !selAgents.includes(s.agent)) return false;
      if (!q) return true;
      return (
        s.id.toLowerCase().includes(q) ||
        s.project.toLowerCase().includes(q) ||
        (s.display ?? "").toLowerCase().includes(q) ||
        (s.text ?? "").toLowerCase().includes(q)
      );
    });
  }, [sessions, query, selAgents]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        tokens: acc.tokens + (s.tokens?.total ?? 0),
        cost: acc.cost + (s.cost ?? 0),
      }),
      { tokens: 0, cost: 0 },
    );
  }, [filtered]);

  const toggleAgent = (a: string) =>
    setSelAgents((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  return (
    <div className="px-8 py-8 max-w-[1600px] mx-auto space-y-8 pb-20">
      <PageHeader
        backHref="/"
        eyebrow="Traces"
        title="Sessions"
        description="Every recorded agent session, newest first. The dashboard shows the 50 most recent; this is the full list."
        icon={<History size={20} strokeWidth={2.25} />}
      />

      <Section title="Totals" description={`${filtered.length.toLocaleString()} sessions shown`}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatTile label="Sessions" value={filtered.length.toLocaleString()} hint="in filter" />
          <StatTile label="Tokens" value={formatTokens(totals.tokens)} hint="in filter" />
          <StatTile label="Est. cost" value={formatCost(totals.cost)} hint="in filter" />
        </div>
      </Section>

      <Card padding="none">
        <div className="px-5 py-4 border-b border-[var(--tt-border)] flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 min-w-[220px] flex-1 max-w-sm bg-[var(--tt-sunken)] border border-[var(--tt-border)] rounded-[var(--tt-radius)] px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-[var(--tt-fg-dim)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by id, project, or text…"
              className="w-full bg-transparent outline-none text-[12px] text-[var(--tt-fg)] placeholder:text-[var(--tt-fg-faint)]"
            />
          </div>
          {agentOptions.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {agentOptions.map((a) => (
                <button
                  key={a}
                  onClick={() => toggleAgent(a)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-medium rounded-full border transition-colors",
                    selAgents.includes(a)
                      ? "border-[var(--tt-brand)] text-[var(--tt-fg)] bg-[var(--tt-brand)]/10"
                      : "border-[var(--tt-border)] text-[var(--tt-fg-dim)] hover:text-[var(--tt-fg)]",
                  )}
                >
                  <AgentLogo agent={a} size={11} />
                  {getAgent(a).label}
                </button>
              ))}
              {selAgents.length > 0 && (
                <button onClick={() => setSelAgents([])} className="text-[10px] text-[var(--tt-fg-dim)] underline ml-1">clear</button>
              )}
            </div>
          )}
        </div>

        {loading && sessions.length === 0 ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<History size={20} />}
            title={sessions.length === 0 ? "No sessions yet" : "No sessions match"}
            description={
              sessions.length === 0
                ? "TokenTelemetry watches local agent runtimes for activity. Run a supported agent to populate this list."
                : "Loosen the filter — no recorded session matches this query."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH className="pl-5">Agent</TH>
                  <TH>Project</TH>
                  <TH>Context</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Cost</TH>
                  <TH className="text-right pr-5">Time</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => {
                  const href = `/sessions/${s.id}?agent=${s.agent}&from=${encodeURIComponent(pathname)}`;
                  const { time, day } = sessionTime(s.timestamp);
                  return (
                    <TR key={`${s.agent}-${s.id}`} interactive>
                      <TD className="pl-5">
                        <Link href={href} className="flex items-center gap-1.5">
                          <AgentBadge agent={s.agent} />
                        </Link>
                      </TD>
                      <TD className="font-mono text-[12px] text-[var(--tt-fg-muted)] max-w-[200px] truncate" title={s.project}>
                        <Link href={href} className="block truncate">{projectBasename(s.project)}</Link>
                      </TD>
                      <TD className="text-[var(--tt-fg)] max-w-[420px] truncate">
                        <Link href={href} className="block truncate">
                          {s.display || s.text || (
                            <span className="italic text-[var(--tt-fg-faint)]">No message content</span>
                          )}
                        </Link>
                      </TD>
                      <TD className="text-right tabular text-[12px] text-[var(--tt-fg-muted)]">
                        {s.tokens ? formatTokens(s.tokens.total) : "—"}
                      </TD>
                      <TD className="text-right tabular text-[12px] text-[var(--tt-fg-muted)]">
                        {s.cost != null ? formatCost(s.cost) : "—"}
                      </TD>
                      <TD className="text-right pr-5 tabular text-[11px] text-[var(--tt-fg-muted)]">
                        <Link href={href} className="block">
                          <div>{time}</div>
                          <div className="text-[10px] text-[var(--tt-fg-faint)] uppercase tracking-wider">{day}</div>
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-[var(--tt-fg-faint)]">
        Showing {filtered.length.toLocaleString()} of {sessions.length.toLocaleString()} sessions · auto-sync 60s
      </p>
    </div>
  );
}
