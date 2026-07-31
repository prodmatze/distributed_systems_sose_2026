"use client"

import { ArrowDown } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"

import { foldForDisplay, type DisplayRow } from "@/lib/observability/fold-display"
import { colorForKind, kindForType, type EvtKind } from "@/lib/observability/summarize"
import { useObsStore } from "@/lib/observability/store"

import { EventRow } from "./event-row"
import { FoldRow } from "./fold-row"

const KINDS: EvtKind[] = ["http", "chat", "docker", "presence", "stats", "other"]

function rowKey(row: DisplayRow): string {
  return row.kind === "event" ? row.env.id : `fold:${row.fromTs}:${row.toTs}:${row.count}`
}

export function Firehose() {
  // Only these two fields come off the store here — the rest of the row
  // (kind color, service hue, corr selection) is read by EventRow itself
  // via its own narrow selectors, so a batch tick only re-renders this
  // list's data prop, not every mounted row.
  const events = useObsStore((s) => s.events)
  const elidedTotal = useObsStore((s) => s.elidedTotal)
  const degraded = useObsStore((s) => s.derived.degraded)
  const conn = useObsStore((s) => s.conn)

  const [activeKinds, setActiveKinds] = useState<Set<EvtKind>>(() => new Set(KINDS))
  const showAll = activeKinds.size === KINDS.length

  // Stick-to-bottom. followOutput only engages while the viewport is already at
  // the bottom, and Virtuoso mounts at the TOP — so after the observer replays
  // its ~300 events of history the view sat on the oldest one and never moved
  // again. Priming it to the newest row once the first batch lands is what
  // actually makes the feed live.
  const listRef = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const primed = useRef(false)
  const lastLen = useRef(0)
  const settleUntil = useRef(0)

  const filtered = useMemo(
    () => (showAll ? events : events.filter((e) => activeKinds.has(kindForType(e.type)))),
    [events, activeKinds, showAll],
  )

  // Flow mode: fold hot same-second runs down to summary rows so an 80/s
  // burst stays a readable list instead of a wall of identical lines.
  const rows = useMemo(() => foldForDisplay(filtered, degraded), [filtered, degraded])

  useEffect(() => {
    if (primed.current || rows.length === 0) return
    primed.current = true
    // Two rAFs: the first lets Virtuoso commit the rows, the second lets it
    // measure them. Scrolling before measurement lands short of the bottom,
    // which leaves atBottom false — and then followOutput never engages and the
    // feed sits frozen while events pile up behind a "N new" button.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: "LAST", align: "end" })
        // Ignore the bottom-state churn the programmatic scroll itself causes.
        settleUntil.current = Date.now() + 1000
      }),
    )
  }, [rows.length])

  // Count what scrolled past while the user was reading further up, so the
  // jump button can say how much they are behind instead of just "new".
  useEffect(() => {
    const grew = rows.length - lastLen.current
    lastLen.current = rows.length
    if (atBottom) setUnseen(0)
    else if (grew > 0) setUnseen((n) => n + grew)
  }, [rows.length, atBottom])

  function jumpToLatest() {
    listRef.current?.scrollToIndex({ index: rows.length - 1, align: "end", behavior: "smooth" })
  }

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
      {rows.length === 0 ? (
        <div className="obs-feed-empty">
          {conn === "live" ? (
            <>
              <strong>Connected. No events yet.</strong>
              <span>
                Press START SIMULATION above, or open the chat app and send a message to see real
                traffic here.
              </span>
            </>
          ) : conn === "closed" ? (
            <>
              <strong>Cannot reach the observer.</strong>
              <span>
                Start it with <code>make obs-up</code>, or press START SIMULATION above to replay a
                recorded feed instead.
              </span>
            </>
          ) : (
            <span>Connecting to the observer...</span>
          )}
        </div>
      ) : (
        <div className="obs-feed-wrap">
          <Virtuoso
            ref={listRef}
            data={rows}
            computeItemKey={(_, row) => rowKey(row)}
            itemContent={(_, row) => (row.kind === "fold" ? <FoldRow row={row} /> : <EventRow env={row.env} />)}
            followOutput="smooth"
            atBottomStateChange={(next) => {
              // While the priming scroll is still settling, a transient "not at
              // bottom" would strand the feed permanently. Treat it as pinned.
              if (!next && Date.now() < settleUntil.current) return
              setAtBottom(next)
            }}
            atBottomThreshold={48}
            style={{ height: "100%" }}
          />
          {!atBottom && (
            <button type="button" className="obs-feed-jump" onClick={jumpToLatest}>
              <ArrowDown size={11} aria-hidden />
              {unseen > 0 ? `${unseen} new` : "jump to latest"}
            </button>
          )}
        </div>
      )}
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
