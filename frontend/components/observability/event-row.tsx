"use client"

import { useObsStore } from "@/lib/observability/store"
import type { StoredEnvelope } from "@/lib/observability/types"

import { colorForKind, kindForType, summarizeEvent } from "@/lib/observability/summarize"

import { ServiceBadge } from "./service-badge"

function formatTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  const mmm = String(d.getMilliseconds()).padStart(3, "0")
  return `${hh}:${mm}:${ss}.${mmm}`
}

// Subscribes to selectedCorr/selectCorr directly (a narrow zustand selector
// per row) rather than taking them as props from Firehose. selectCorr's
// reference never changes so it never re-renders the row; selectedCorr only
// re-renders the handful of rows Virtuoso keeps mounted, and it's the only
// way a row can know "am I the highlighted one" without the parent list
// re-rendering (and re-diffing) on every corr click.
export function EventRow({ env }: { env: StoredEnvelope }) {
  const selectedCorr = useObsStore((s) => s.selectedCorr)
  const selectCorr = useObsStore((s) => s.selectCorr)
  const kind = kindForType(env.type)
  const kindColor = colorForKind(kind)
  const selected = env.corr !== null && env.corr === selectedCorr

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "1px var(--space-4)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.7,
        whiteSpace: "nowrap",
        background: selected ? "var(--accent-dim)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      <span className="obs-num" style={{ color: "var(--text-3)", flexShrink: 0 }}>
        {formatTime(env.tsMs)}
      </span>
      <span className="obs-chip" style={{ color: kindColor, borderColor: "transparent", flexShrink: 0 }}>
        {kind.toUpperCase()}
      </span>
      <ServiceBadge service={env.service} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-1)" }}>
        {summarizeEvent(env)}
      </span>
      {env.corr && (
        <button
          type="button"
          className="obs-chip"
          onClick={() => selectCorr(env.corr)}
          style={{
            marginLeft: "auto",
            flexShrink: 0,
            cursor: "pointer",
            color: selected ? "var(--accent)" : "var(--text-2)",
            borderColor: selected ? "var(--accent-border)" : "var(--border-1)",
            background: "transparent",
          }}
        >
          ⌁{env.corr.slice(0, 8)}
        </button>
      )}
    </div>
  )
}
