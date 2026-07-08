"use client"

import { useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"

import { colorForKind, kindForType, type EvtKind } from "@/lib/observability/summarize"
import { useObsStore } from "@/lib/observability/store"

import { EventRow } from "./event-row"

const KINDS: EvtKind[] = ["http", "chat", "docker", "presence", "stats", "other"]

export function Firehose() {
  // Only these two fields come off the store here — the rest of the row
  // (kind color, service hue, corr selection) is read by EventRow itself
  // via its own narrow selectors, so a batch tick only re-renders this
  // list's data prop, not every mounted row.
  const events = useObsStore((s) => s.events)
  const elidedTotal = useObsStore((s) => s.elidedTotal)

  const [activeKinds, setActiveKinds] = useState<Set<EvtKind>>(() => new Set(KINDS))
  const [paused, setPaused] = useState(false)
  const showAll = activeKinds.size === KINDS.length

  const filtered = useMemo(
    () => (showAll ? events : events.filter((e) => activeKinds.has(kindForType(e.type)))),
    [events, activeKinds, showAll],
  )

  function toggleKind(k: EvtKind) {
    setActiveKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  return (
    <>
      <div className="obs-panel-title" style={{ flexWrap: "wrap", rowGap: "var(--space-2)" }}>
        EVENT FEED
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginLeft: "auto" }}>
          <button
            type="button"
            className="obs-chip"
            onClick={() => setActiveKinds(new Set(KINDS))}
            style={{
              cursor: "pointer",
              color: showAll ? "var(--accent)" : "var(--text-2)",
              borderColor: showAll ? "var(--accent-border)" : "var(--border-1)",
              background: showAll ? "var(--accent-dim)" : "transparent",
            }}
          >
            ALL
          </button>
          {KINDS.map((k) => {
            const active = activeKinds.has(k)
            const color = colorForKind(k)
            return (
              <button
                key={k}
                type="button"
                className="obs-chip"
                onClick={() => toggleKind(k)}
                style={{
                  cursor: "pointer",
                  color: active ? color : "var(--text-3)",
                  borderColor: active ? color : "var(--border-1)",
                  background: "transparent",
                }}
              >
                {k.toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>
      <Virtuoso
        data={filtered}
        computeItemKey={(_, env) => env.id}
        itemContent={(_, env) => <EventRow env={env} />}
        followOutput={paused ? false : "smooth"}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{ flex: 1 }}
      />
      {elidedTotal > 0 && (
        <div style={{ padding: "var(--space-2) var(--space-4)", borderTop: "1px solid var(--border-1)", flexShrink: 0 }}>
          <span className="obs-chip" style={{ color: "var(--status-warn)", borderColor: "var(--status-warn)" }}>
            ⚠ {elidedTotal} elided
          </span>
        </div>
      )}
    </>
  )
}
