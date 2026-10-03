"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Bot, FlaskConical, Gauge } from "lucide-react";

import { useResource } from "@/lib/api";
import { AGENTS, getAgent } from "@/lib/agents";
import { AgentLogo } from "@/components/icons/AgentLogo";
import { useQuotas } from "@/components/QuotaProvider";
import { PlanLimitsList } from "@/components/quota/PlanLimitsList";
import { AgentFeatureFlags } from "@/components/settings/AgentFeatureFlags";
import { quotaColor, worstWindowFor, type QuotaCapability } from "@/lib/quotas";
import { formatTokens } from "@/lib/format";
import {
  PageHeader, Section, Card, CardHeader, CardTitle, CardEyebrow,
  AgentBadge, EmptyState, Skeleton,
} from "@/components/ui";

interface SessionRow {
  id: string;
  agent: string;
  tokens?: { total: number };
}

const QUOTA_STATE_LABEL: Record<string, string> = {
  available: "Live",
  notSignedIn: "Not signed in",
  sessionExpired: "Session expired",
  notEntitled: "No plan quota",
  refreshFailed: "Refresh failed",
  notSupported: "No live quota",
};

function QuotaChip({ agent }: { agent: string }) {
  const { data } = useQuotas();
  const snapshot = data?.providers[agent];
  const capability: QuotaCapability | undefined = data?.capabilities[agent];
  const worst = worstWindowFor(agent, snapshot);

  if (worst) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] tabular"
        style={{ color: quotaColor(worst.pct) }}
        title={`${worst.displayName} · ${worst.label}: ${Math.round(worst.pct)}% used`}
      >
        <Gauge size={11} />
        {worst.label} · {Math.round(worst.pct)}%
      </span>
    );
  }
  const label = QUOTA_STATE_LABEL[capability?.state ?? ""] ?? "No quota entry";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-[var(--tt-fg-faint)]"
      title={capability?.detail ?? "This agent reports no plan-limit quota."}
    >
      <Gauge size={11} />
      {label}
    </span>
  );
}

export default function AgentsPage() {
  const { data: detected, loading: agentsLoading } = useResource<string[]>("/agents", { initial: [] });
  const { data: sessions } = useResource<SessionRow[]>("/sessions", { pollMs: 15_000, initial: [] });
  const { data: quotas, loading: quotasLoading } = useQuotas();

  const stats = useMemo(() => {
    const counts = new Map<string, { sessions: number; tokens: number }>();
    for (const s of sessions ?? []) {
      const e = counts.get(s.agent) ?? { sessions: 0, tokens: 0 };
      e.sessions += 1;
      e.tokens += s.tokens?.total ?? 0;
      counts.set(s.agent, e);
    }
    return counts;
  }, [sessions]);

  // Detected agents first by session count; unknown keys fall back gracefully.
  const ordered = useMemo(() => {
    const keys = Array.from(new Set([...(detected ?? []), ...Object.keys(AGENTS)]));
    return keys
      .filter((k) => (stats.get(k)?.sessions ?? 0) > 0 || (detected ?? []).includes(k))
      .sort((a, b) => (stats.get(b)?.sessions ?? 0) - (stats.get(a)?.sessions ?? 0));
  }, [detected, stats]);

  const liveProviders = useMemo(
    () => Object.entries(quotas?.providers ?? {}),
    [quotas],
  );
  const unavailable = useMemo(
    () =>
      Object.entries(quotas?.capabilities ?? {})
        .filter(([id]) => !(id in (quotas?.providers ?? {})))
        .sort(([a], [b]) => a.localeCompare(b)),
    [quotas],
  );

  return (
    <div className="px-8 py-8 max-w-[1600px] mx-auto space-y-10 pb-20">
      <PageHeader
        backHref="/"
        eyebrow="Agents"
        title="Coding agents"
        description="Every agent detected on this machine, its plan-limit quota state, and the experimental flags each one exposes in local config."
        icon={<Bot size={20} strokeWidth={2.25} />}
      />

      <Section
        title="Connected"
        description="Agents with local runtimes on this machine. Select one for its disk footprint, harness panels, and session history."
      >
        {agentsLoading && ordered.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={<Bot size={20} />}
            title="No agents detected"
            description="No supported agent runtimes were found on this machine."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {ordered.map((k) => {
              const meta = getAgent(k);
              const st = stats.get(k);
              return (
                <Link
                  key={k}
                  href={`/agents/${k}`}
                  className="group rounded-[var(--tt-radius-lg)] border border-[var(--tt-border)] bg-[var(--tt-panel)] p-4 transition-colors hover:border-[var(--tt-border-strong)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <AgentLogo agent={k} size={18} />
                      <span className="text-[14px] font-medium text-[var(--tt-fg)] truncate">
                        {meta.label}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={14}
                      className="shrink-0 text-[var(--tt-fg-faint)] transition-all group-hover:text-[var(--tt-brand)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[var(--tt-fg-muted)]">
                    <span className="tabular">
                      {(st?.sessions ?? 0).toLocaleString()} sessions
                      {st && st.tokens > 0 && ` · ${formatTokens(st.tokens)}`}
                    </span>
                    <QuotaChip agent={k} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Plan limits"
        description="Live quota windows each provider reports, closest to a ceiling first — the same meters as the sidebar popover, with the agents that have no live quota named below instead of folded into a count."
      >
        <Card padding="none">
          {quotasLoading && liveProviders.length === 0 ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <>
              <PlanLimitsList providers={liveProviders} />
              {unavailable.length > 0 && (
                <div className="border-t border-[var(--tt-border)] px-3.5 py-3 space-y-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--tt-fg-dim)]">
                    {unavailable.length} {unavailable.length === 1 ? "agent has" : "agents have"} no live quota
                  </div>
                  {unavailable.map(([id, cap]) => (
                    <div key={id} className="flex items-start gap-2.5">
                      <AgentBadge agent={id} />
                      <p className="text-[11px] text-[var(--tt-fg-dim)] leading-relaxed min-w-0">
                        {cap.detail ?? QUOTA_STATE_LABEL[cap.state] ?? cap.state}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      </Section>

      <Section
        title="Feature flags"
        description="Experimental toggles each agent stores in its own local config. Read-only — change them in the agent, not here."
        actions={
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--tt-fg-dim)]">
            <FlaskConical size={11} /> Local config
          </span>
        }
      >
        <AgentFeatureFlags />
      </Section>

      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <Bot size={13} className="text-[var(--tt-brand)]" /> Per-agent detail
          </CardTitle>
          <CardEyebrow>Panels</CardEyebrow>
        </CardHeader>
        <p className="text-[12px] text-[var(--tt-fg-muted)] leading-relaxed">
          Each card above opens that agent&apos;s panel page — disk footprint, harness-specific
          stores (cron schedules, background jobs, billing units), and everything the session
          scan doesn&apos;t show.{" "}
          <Link href="/analytics" className="inline-flex items-center gap-1 font-medium text-[var(--tt-brand)] hover:underline">
            Compare usage in analytics <ArrowRight size={11} />
          </Link>
        </p>
      </Card>
    </div>
  );
}
