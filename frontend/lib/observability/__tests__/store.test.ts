import { describe, expect, test } from "vitest"

import { createObsStore } from "@/lib/observability/store"
import type { Envelope, WorldSnapshot } from "@/lib/observability/types"

const T0 = Date.parse("2026-07-08T12:00:00.000Z")
const iso = (ms: number) => new Date(ms).toISOString()

let seq = 0
function env(partial: Partial<Envelope> & { type: string }, atMs = T0): Envelope {
  seq += 1
  return {
    id: `${atMs}-${seq}`,
    service: "api",
    ts: iso(atMs),
    corr: null,
    payload: {},
    ...partial,
  }
}

const snapshot: WorldSnapshot = {
  containers: {
    "chorus-chat-1": { service: "chat", state: "running", health: null, status: "Up", stats: {} },
    "chorus-chat-2": { service: "chat", state: "running", health: null, status: "Up", stats: {} },
  },
  online_users: [1, 2, 3],
  rates: {},
  replicas: 3,
  last_event_id: "100-0",
}

describe("ingest + dedupe", () => {
  test("dedupes by envelope id across batches", () => {
    const s = createObsStore()
    const e = env({ type: "http.request" })
    s.getState().ingestBatch([e], 0, T0)
    s.getState().ingestBatch([e, env({ type: "http.request" })], 0, T0)
    expect(s.getState().events).toHaveLength(2)
  })

  test("ring buffer caps at 2000", () => {
    const s = createObsStore()
    const batch = Array.from({ length: 2100 }, (_, i) => env({ type: "http.request" }, T0 + i))
    s.getState().ingestBatch(batch, 0, T0 + 2100)
    expect(s.getState().events).toHaveLength(2000)
    expect(s.getState().events[0].tsMs).toBe(T0 + 100)
  })

  test("tracks lastEventId and elided total", () => {
    const s = createObsStore()
    s.getState().ingestBatch([env({ type: "x", id: "42-1" })], 3, T0)
    expect(s.getState().lastEventId).toBe("42-1")
    expect(s.getState().elidedTotal).toBe(3)
  })

  test("onFresh listeners get only fresh (non-duplicate) events", () => {
    const s = createObsStore()
    const got: string[] = []
    s.getState().onFresh((fresh) => got.push(...fresh.map((e) => e.id)))
    const e = env({ type: "http.request" })
    s.getState().ingestBatch([e], 0, T0)
    s.getState().ingestBatch([e], 0, T0)
    expect(got).toEqual([e.id])
  })
})

describe("world folding", () => {
  test("applySnapshot replaces world", () => {
    const s = createObsStore()
    s.getState().applySnapshot(snapshot)
    expect(s.getState().world.replicas).toBe(3)
    expect(Object.keys(s.getState().world.containers)).toHaveLength(2)
  })

  test("docker.containers is authoritative and folds before other events in the same batch", () => {
    const s = createObsStore()
    // stats for a container arrive in the same batch BEFORE the containers list —
    // the list must still win as base, with stats applied on top
    const stats = env({
      type: "docker.stats",
      service: "docker",
      payload: { stats: { "chorus-api-1": { cpu_pct: 12.5, mem_mb: 80, mem_pct: 4, rx_kb: 1, tx_kb: 2 } } },
    })
    const containers = env({
      type: "docker.containers",
      service: "docker",
      payload: { containers: [{ name: "chorus-api-1", service: "api", state: "running", health: null, status: "Up" }] },
    }, T0 + 1)
    s.getState().ingestBatch([stats, containers], 0, T0 + 1)
    const c = s.getState().world.containers["chorus-api-1"]
    expect(c.state).toBe("running")
    expect(c.stats.cpu_pct).toBe(12.5)
  })

  test("docker.event die/start flips container state", () => {
    const s = createObsStore()
    s.getState().applySnapshot(snapshot)
    s.getState().ingestBatch(
      [env({ type: "docker.event", service: "docker", payload: { action: "die", container: "chorus-chat-2", exit_code: "137" } })],
      0, T0)
    expect(s.getState().world.containers["chorus-chat-2"].state).toBe("exited")
    s.getState().ingestBatch(
      [env({ type: "docker.event", service: "docker", payload: { action: "start", container: "chorus-chat-2" } }, T0 + 1)],
      0, T0 + 1)
    expect(s.getState().world.containers["chorus-chat-2"].state).toBe("running")
  })

  test("presence events maintain online users", () => {
    const s = createObsStore()
    s.getState().applySnapshot(snapshot)
    s.getState().ingestBatch([env({ type: "presence.online", service: "chat", payload: { user_id: 9 } })], 0, T0)
    s.getState().ingestBatch([env({ type: "presence.offline", service: "chat", payload: { user_id: 1 } }, T0 + 1)], 0, T0 + 1)
    expect(s.getState().world.online_users).toEqual([2, 3, 9])
  })

  test("replicas track redis.stats chat_subscribers (never numpat)", () => {
    const s = createObsStore()
    s.getState().ingestBatch(
      [env({ type: "redis.stats", service: "redis", payload: { chat_subscribers: 2, numpat: 7 } })],
      0, T0)
    expect(s.getState().world.replicas).toBe(2)
  })
})

describe("tick / derived", () => {
  test("reqRate over 10s window; msgRate sums chat.message.summary counts", () => {
    const s = createObsStore()
    const batch: Envelope[] = []
    for (let i = 0; i < 20; i++) batch.push(env({ type: "http.request" }, T0 - i * 400))
    batch.push(env({ type: "chat.message", service: "chat" }, T0 - 1000))
    batch.push(env({ type: "chat.message.summary", service: "chat", payload: { count: 39 } }, T0 - 2000))
    s.getState().ingestBatch(batch, 0, T0)
    s.getState().tick(T0)
    const d = s.getState().derived
    expect(d.reqRate).toBeCloseTo(20 / 10, 5)
    expect(d.msgRate).toBeCloseTo(40 / 10, 5)
  })

  test("degrade hysteresis: on after 2 hot ticks, off after 3 cool ticks", () => {
    const s = createObsStore()
    const hot = (at: number) =>
      s.getState().ingestBatch(Array.from({ length: 300 }, (_, i) => env({ type: "http.request" }, at - i * 15)), 0, at)
    hot(T0);            s.getState().tick(T0)
    expect(s.getState().derived.degraded).toBe(false)
    hot(T0 + 1000);     s.getState().tick(T0 + 1000)
    expect(s.getState().derived.degraded).toBe(true)
    s.getState().tick(T0 + 11000)
    s.getState().tick(T0 + 12000)
    expect(s.getState().derived.degraded).toBe(true)
    s.getState().tick(T0 + 13000)
    expect(s.getState().derived.degraded).toBe(false)
  })

  test("spark arrays have 60 buckets, newest last", () => {
    const s = createObsStore()
    s.getState().ingestBatch([env({ type: "http.request" }, T0 - 500)], 0, T0)
    s.getState().tick(T0)
    const spark = s.getState().derived.spark
    expect(spark.req).toHaveLength(60)
    expect(spark.req[59]).toBe(1)
    expect(spark.req[0]).toBe(0)
  })

  test("derived mirrors world counters", () => {
    const s = createObsStore()
    s.getState().applySnapshot(snapshot)
    s.getState().ingestBatch(
      [env({ type: "docker.event", service: "docker", payload: { action: "die", container: "chorus-chat-2" } })],
      0, T0)
    s.getState().tick(T0)
    const d = s.getState().derived
    expect(d.onlineUsers).toBe(3)
    expect(d.containersTotal).toBe(2)
    expect(d.containersUp).toBe(1)
    expect(d.replicas).toBe(3)
  })

  test("resumedFrom clears ~5s after markResumed", () => {
    const s = createObsStore()
    s.getState().markResumed("100-0", T0)
    expect(s.getState().resumedFrom).toBe("100-0")
    s.getState().tick(T0 + 6000)
    expect(s.getState().resumedFrom).toBeNull()
  })

  test("beginFresh clears buffer and dedupe memory", () => {
    const s = createObsStore()
    const e = env({ type: "http.request" })
    s.getState().ingestBatch([e], 0, T0)
    s.getState().beginFresh()
    expect(s.getState().events).toHaveLength(0)
    s.getState().ingestBatch([e], 0, T0)
    expect(s.getState().events).toHaveLength(1)
  })
})
