import { describe, expect, test, vi } from "vitest"

import { createMockSource, mulberry32 } from "@/lib/observability/mock"
import type { WsFrame } from "@/lib/observability/types"

const T0 = Date.parse("2026-07-08T12:00:00.000Z")

function collect(runMs: number, seed = 1): WsFrame[] {
  vi.useFakeTimers()
  const frames: WsFrame[] = []
  const stop = createMockSource({ seed, t0: T0 }).start({
    onFrame: (f) => frames.push(f),
    onStatus: () => {},
    onConnect: () => {},
    resumeFrom: () => null,
  })
  vi.advanceTimersByTime(runMs)
  stop()
  vi.useRealTimers()
  return frames
}

describe("mock stream", () => {
  test("opens with snapshot then a history batch", () => {
    const frames = collect(0)
    expect(frames[0].type).toBe("snapshot")
    if (frames[0].type !== "snapshot") return
    expect(frames[0].state.replicas).toBe(3)
    expect(Object.keys(frames[0].state.containers).length).toBeGreaterThanOrEqual(9)
    expect(frames[1].type).toBe("batch")
    if (frames[1].type !== "batch") return
    expect(frames[1].events.length).toBeGreaterThan(100)
  })

  test("emits live batches with unique increasing ids", () => {
    const frames = collect(3000)
    const ids = frames.filter((f) => f.type === "batch").flatMap((f) => (f.type === "batch" ? f.events : [])).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sorted = [...ids].sort((a, b) => {
      const [am, as] = a.split("-").map(Number)
      const [bm, bs] = b.split("-").map(Number)
      return am - bm || as - bs
    })
    expect(ids).toEqual(sorted)
  })

  test("is deterministic for a fixed seed", () => {
    const a = JSON.stringify(collect(2000, 7))
    const b = JSON.stringify(collect(2000, 7))
    expect(a).toBe(b)
  })

  test("kills and revives chorus-chat-2 within the scripted loop", () => {
    const events = collect(35_000).flatMap((f) => (f.type === "batch" ? f.events : []))
    const dockerEvents = events.filter((e) => e.type === "docker.event" && e.payload.container === "chorus-chat-2")
    const actions = dockerEvents.map((e) => e.payload.action)
    expect(actions).toContain("die")
    expect(actions).toContain("start")
    expect(actions.indexOf("die")).toBeLessThan(actions.lastIndexOf("start"))
  })

  test("burst window exceeds 50 events/s", () => {
    const events = collect(48_000).flatMap((f) => (f.type === "batch" ? f.events : []))
    const perSecond = new Map<number, number>()
    for (const e of events) {
      const s = Math.floor(Date.parse(e.ts) / 1000)
      perSecond.set(s, (perSecond.get(s) ?? 0) + 1)
    }
    expect(Math.max(...perSecond.values())).toBeGreaterThan(50)
  })
})

test("mulberry32 is deterministic", () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  expect([a(), a(), a()]).toEqual([b(), b(), b()])
})
