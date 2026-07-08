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

  test("payload shapes match the observer protocol", () => {
    // 21s so the scripted die event (phase 20) is in the collection too
    const events = collect(21_000).flatMap((f) => (f.type === "batch" ? f.events : []))
    const first = (t: string) => {
      const e = events.find((e) => e.type === t)
      if (!e) throw new Error(`no ${t} event generated`)
      return e
    }

    const http = first("http.request")
    expect(Object.keys(http.payload).sort()).toEqual(["method", "remote", "rt_ms", "status", "upstream", "uri"])
    expect(typeof http.corr).toBe("string")

    const chat = first("chat.message")
    expect(typeof chat.payload.channel_id).toBe("number")
    const msg = chat.payload.message as Record<string, unknown>
    expect(Object.keys(msg).sort()).toEqual(["body", "channel_id", "created_at", "id", "sender_id", "sender_username", "type"])

    const summary = first("chat.message.summary")
    expect(typeof summary.payload.count).toBe("number")

    const stats = (first("docker.stats").payload.stats as Record<string, Record<string, unknown>>)["chorus-chat-1"]
    expect(Object.keys(stats).sort()).toEqual(["cpu_pct", "mem_mb", "mem_pct", "rx_kb", "tx_kb"])

    const dockerEvent = first("docker.event")
    expect(typeof dockerEvent.payload.action).toBe("string")
    expect(typeof dockerEvent.payload.container).toBe("string")
    expect(typeof dockerEvent.payload.service).toBe("string")

    // first redis.stats is from history — steady traffic, all 3 replicas alive
    const redis = first("redis.stats").payload
    expect(redis.chat_subscribers).toBe(3)
    expect(redis.numpat).not.toBe(redis.chat_subscribers)
    expect(Array.isArray(redis.presence)).toBe(true)
    expect(Array.isArray(redis.clients)).toBe(true)

    const db = first("db.stats").payload
    expect(typeof db.commits_per_s).toBe("number")
    expect(typeof db.cache_hit_pct).toBe("number")
    expect(Array.isArray(db.queries)).toBe(true)
    expect(Array.isArray(db.connections)).toBe(true)
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
