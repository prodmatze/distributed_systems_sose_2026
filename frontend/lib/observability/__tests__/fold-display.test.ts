import { describe, expect, test } from "vitest"

import { foldForDisplay, quantizeRate } from "@/lib/observability/fold-display"
import type { StoredEnvelope } from "@/lib/observability/types"

// secBase is a whole-second epoch; offsetMs lets a caller place several
// events within the same wall-second (Math.floor(tsMs/1000)) or push one
// into the next second.
function ev(id: string, secBase: number, offsetMs = 0): StoredEnvelope {
  const tsMs = secBase * 1000 + offsetMs
  return {
    id,
    type: "chat.message",
    service: "chat",
    ts: new Date(tsMs).toISOString(),
    corr: null,
    payload: {},
    tsMs,
  }
}

function burst(count: number, secBase: number, startId = 0): StoredEnvelope[] {
  const out: StoredEnvelope[] = []
  for (let i = 0; i < count; i++) {
    // Spread within the second, strictly increasing, never crossing into the
    // next second (count is always small enough here).
    out.push(ev(`${startId + i}`, secBase, i))
  }
  return out
}

describe("foldForDisplay", () => {
  test("passthrough when not degraded: identity mapping, order preserved", () => {
    const events = burst(5, 1000)
    const rows = foldForDisplay(events, false)
    expect(rows).toEqual(events.map((env) => ({ kind: "event", env })))
  })

  test("passthrough ignores second boundaries entirely when not degraded", () => {
    const events = [...burst(30, 1000), ...burst(30, 1001, 30)]
    const rows = foldForDisplay(events, false)
    expect(rows).toHaveLength(60)
    expect(rows.every((r) => r.kind === "event")).toBe(true)
  })

  test("a 100-event same-second burst folds to a single row with the right count", () => {
    const events = burst(100, 2000)
    const rows = foldForDisplay(events, true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: "fold", count: 100 })
    if (rows[0].kind === "fold") {
      expect(rows[0].fromTs).toBe(events[0].ts)
      expect(rows[0].toTs).toBe(events[99].ts)
    }
  })

  test("several same-second bursts across seconds fold to a handful of rows, counts preserved", () => {
    const events = [...burst(40, 3000), ...burst(50, 3001, 40), ...burst(30, 3002, 90)]
    const rows = foldForDisplay(events, true)
    expect(rows.length).toBeLessThanOrEqual(5)
    const totalFolded = rows.reduce((n, r) => (r.kind === "fold" ? n + r.count : n + 1), 0)
    expect(totalFolded).toBe(120)
  })

  test("boundary: a run of exactly 20 consecutive same-second events stays unfolded", () => {
    const events = burst(20, 4000)
    const rows = foldForDisplay(events, true)
    expect(rows).toHaveLength(20)
    expect(rows.every((r) => r.kind === "event")).toBe(true)
  })

  test("boundary: a run of 21 consecutive same-second events folds to one row", () => {
    const events = burst(21, 4100)
    const rows = foldForDisplay(events, true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: "fold", count: 21 })
  })

  test("runs spanning a second boundary split into two separate folds", () => {
    // 25 consecutive events in second 5000, immediately followed by 25 more
    // in second 5001 — each run is independently >20 and folds on its own;
    // they must not merge into one 50-count fold.
    const events = [...burst(25, 5000), ...burst(25, 5001, 25)]
    const rows = foldForDisplay(events, true)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: "fold", count: 25 })
    expect(rows[1]).toMatchObject({ kind: "fold", count: 25 })
  })

  test("a run interrupted by a different second, then resumed, does not merge back together", () => {
    // 25 in second 6000, 1 in second 6001, 25 more nominally "6000" again —
    // non-consecutive occurrences of the same second must not be merged; the
    // middle event breaks the run, so we get three separate groups.
    const events = [...burst(25, 6000), ...burst(1, 6001, 100), ...burst(25, 6000, 200)]
    const rows = foldForDisplay(events, true)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ kind: "fold", count: 25 })
    expect(rows[1]).toMatchObject({ kind: "event" })
    expect(rows[2]).toMatchObject({ kind: "fold", count: 25 })
  })

  test("small same-second runs (<=20) pass through as individual event rows even when degraded", () => {
    const events = burst(10, 7000)
    const rows = foldForDisplay(events, true)
    expect(rows).toEqual(events.map((env) => ({ kind: "event", env })))
  })

  test("empty input returns empty output in both modes", () => {
    expect(foldForDisplay([], true)).toEqual([])
    expect(foldForDisplay([], false)).toEqual([])
  })
})

describe("quantizeRate", () => {
  test("buckets to 0, 10, 25, or 50", () => {
    expect(quantizeRate(0)).toBe(0)
    expect(quantizeRate(1)).toBe(0)
    expect(quantizeRate(10)).toBe(10)
    expect(quantizeRate(25)).toBe(25)
    expect(quantizeRate(50)).toBe(50)
    expect(quantizeRate(1000)).toBe(50)
  })

  test("boundaries sit at the midpoints between buckets", () => {
    // midpoints: (0+10)/2=5, (10+25)/2=17.5, (25+50)/2=37.5
    expect(quantizeRate(4.9)).toBe(0)
    expect(quantizeRate(5)).toBe(10)
    expect(quantizeRate(17.4)).toBe(10)
    expect(quantizeRate(17.5)).toBe(25)
    expect(quantizeRate(37.4)).toBe(25)
    expect(quantizeRate(37.5)).toBe(50)
  })
})
