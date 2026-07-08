"use client"

import { useObsStore } from "@/lib/observability/store"

const LOOK: Record<string, { label: string; color: string; dim: string }> = {
  connecting: { label: "connecting", color: "var(--status-warn)", dim: "var(--status-warn-dim)" },
  live: { label: "live", color: "var(--status-ok)", dim: "var(--status-ok-dim)" },
  reconnecting: { label: "reconnecting", color: "var(--status-warn)", dim: "var(--status-warn-dim)" },
  closed: { label: "offline", color: "var(--status-crit)", dim: "var(--status-crit-dim)" },
}

export function ConnectionPill() {
  const conn = useObsStore((s) => s.conn)
  const resumedFrom = useObsStore((s) => s.resumedFrom)
  const mock = useObsStore((s) => s.mock)
  const look = LOOK[conn]
  return (
    <span style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center" }}>
      {mock && (
        <span className="obs-chip" style={{ color: "var(--accent)", borderColor: "var(--accent-border)" }}>
          MOCK FEED
        </span>
      )}
      {resumedFrom && (
        <span className="obs-chip" style={{ color: "var(--accent)" }}>
          ⟳ resumed from #{resumedFrom}
        </span>
      )}
      <span
        className="obs-chip"
        data-conn={conn}
        style={{ color: look.color, background: look.dim, borderColor: "transparent" }}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: 999, background: look.color, display: "inline-block" }}
        />
        {look.label.toUpperCase()}
      </span>
    </span>
  )
}
