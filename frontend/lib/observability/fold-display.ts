// The firehose's degrade path. Rendering one row per envelope at 80/s makes
// the list unreadable and starts costing real React re-renders; folding a hot
// same-second run into a single summary row keeps the feed legible and cheap
// without hiding that traffic happened. Pure and side-effect free — the same
// shape whether fed live events or a replay buffer.
import type { StoredEnvelope } from "./types"

export type DisplayRow =
  | { kind: "event"; env: StoredEnvelope }
  | { kind: "fold"; count: number; fromTs: string; toTs: string }

const FOLD_THRESHOLD = 20

function wallSecond(tsMs: number): number {
  return Math.floor(tsMs / 1000)
}

// Identity mapping when not degraded. When degraded, walk the list and
// group maximal *consecutive* runs sharing the same wall-second (a run
// breaks the moment the second changes, even if that same second recurs
// later — no re-merging across a gap). Any run longer than FOLD_THRESHOLD
// collapses to a single fold row; runs at or under the threshold — including
// the boundary case of exactly 20 — pass through as individual event rows.
export function foldForDisplay(events: StoredEnvelope[], degraded: boolean): DisplayRow[] {
  if (!degraded) return events.map((env) => ({ kind: "event", env }))

  const rows: DisplayRow[] = []
  let i = 0
  while (i < events.length) {
    const sec = wallSecond(events[i].tsMs)
    let j = i + 1
    while (j < events.length && wallSecond(events[j].tsMs) === sec) j++
    const runLen = j - i
    if (runLen > FOLD_THRESHOLD) {
      rows.push({
        kind: "fold",
        count: runLen,
        fromTs: events[i].ts,
        toTs: events[j - 1].ts,
      })
    } else {
      for (let k = i; k < j; k++) rows.push({ kind: "event", env: events[k] })
    }
    i = j
  }
  return rows
}

// Buckets a raw, 1 Hz-changing events/s figure onto a small fixed set of
// values so the idle-edge SMIL dot's `dur` (animated-edge.tsx) only changes
// on a real regime shift, not every tick — a live-changing dur restarts the
// animateMotion element in every browser. Boundaries sit at the midpoints
// between adjacent buckets.
export function quantizeRate(rate: number): 0 | 10 | 25 | 50 {
  if (rate < 5) return 0
  if (rate < 17.5) return 10
  if (rate < 37.5) return 25
  return 50
}
