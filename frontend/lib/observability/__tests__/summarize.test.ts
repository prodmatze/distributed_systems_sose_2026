import { describe, expect, test } from "vitest"

import { colorForKind, kindForType, summarizeEvent } from "@/lib/observability/summarize"
import type { Envelope } from "@/lib/observability/types"

function env(type: string, payload: Record<string, unknown>): Envelope {
  return { id: "1720374000123-0", type, service: "api", ts: "2026-07-08T18:42:08.501Z", corr: null, payload }
}

describe("kindForType", () => {
  test("maps every known event type to its kind", () => {
    expect(kindForType("http.request")).toBe("http")
    expect(kindForType("chat.message")).toBe("chat")
    expect(kindForType("chat.message.summary")).toBe("chat")
    expect(kindForType("docker.event")).toBe("docker")
    expect(kindForType("docker.containers")).toBe("docker")
    expect(kindForType("docker.stats")).toBe("docker")
    expect(kindForType("presence.online")).toBe("presence")
    expect(kindForType("presence.offline")).toBe("presence")
    expect(kindForType("db.stats")).toBe("stats")
    expect(kindForType("redis.stats")).toBe("stats")
    expect(kindForType("observer.health")).toBe("stats")
  })

  test("unknown type falls back to other", () => {
    expect(kindForType("span.new")).toBe("other")
  })
})

describe("colorForKind", () => {
  test("returns a css var string per kind", () => {
    expect(colorForKind("http")).toBe("var(--evt-http)")
    expect(colorForKind("chat")).toBe("var(--evt-redis)")
    expect(colorForKind("docker")).toBe("var(--svc-docker)")
    expect(colorForKind("presence")).toBe("var(--evt-ws)")
    expect(colorForKind("other")).toBe("var(--text-3)")
  })
})

describe("summarizeEvent", () => {
  test("http.request", () => {
    const e = env("http.request", { method: "GET", uri: "/api/channels", status: 200, rt_ms: 12.4, upstream: "172.19.0.11", remote: "10.0.0.1" })
    expect(summarizeEvent(e)).toBe("GET /api/channels → 200 12.4ms")
  })

  test("chat.message", () => {
    const e = env("chat.message", { channel_id: 3, message: { sender_username: "alice", body: "hey bob!" } })
    expect(summarizeEvent(e)).toBe("alice → #3: hey bob!")
  })

  test("chat.message truncates body at 60 chars with an ellipsis", () => {
    const body = "x".repeat(70)
    const e = env("chat.message", { channel_id: 1, message: { sender_username: "bob", body } })
    expect(summarizeEvent(e)).toBe(`bob → #1: ${"x".repeat(60)}…`)
  })

  test("chat.message.summary", () => {
    const e = env("chat.message.summary", { count: 39 })
    expect(summarizeEvent(e)).toBe("▸ 39 messages coalesced")
  })

  test("docker.event die with exit code", () => {
    const e = env("docker.event", { action: "die", container: "chorus-chat-2", service: "chat", exit_code: "137" })
    expect(summarizeEvent(e)).toBe("die chorus-chat-2 (137)")
  })

  test("docker.event start without exit code", () => {
    const e = env("docker.event", { action: "start", container: "chorus-chat-2", service: "chat" })
    expect(summarizeEvent(e)).toBe("start chorus-chat-2")
  })

  test("docker.containers", () => {
    const containers = Array.from({ length: 11 }, (_, i) => ({ name: `c${i}`, service: "chat", state: "running", health: null, status: "Up" }))
    const e = env("docker.containers", { containers })
    expect(summarizeEvent(e)).toBe("container inventory (11)")
  })

  test("docker.stats", () => {
    const stats: Record<string, unknown> = {}
    for (let i = 0; i < 11; i++) stats[`chorus-c-${i}`] = { cpu_pct: 1, mem_mb: 1, mem_pct: 1, rx_kb: 1, tx_kb: 1 }
    const e = env("docker.stats", { stats })
    expect(summarizeEvent(e)).toBe("stats for 11 containers")
  })

  test("presence.online", () => {
    const e = env("presence.online", { user_id: 7 })
    expect(summarizeEvent(e)).toBe("user 7 online")
  })

  test("presence.offline", () => {
    const e = env("presence.offline", { user_id: 7 })
    expect(summarizeEvent(e)).toBe("user 7 offline")
  })

  test("redis.stats", () => {
    const e = env("redis.stats", { chat_subscribers: 3, ops_per_sec: 2841, connected_clients: 5, numpat: 99, presence: [], clients: [] })
    expect(summarizeEvent(e)).toBe("2841 ops/s · 3 subscribers")
  })

  test("db.stats", () => {
    const e = env("db.stats", { commits_per_s: 4.0, cache_hit_pct: 99.1, queries: [], connections: [] })
    expect(summarizeEvent(e)).toBe("4.0 commits/s · 99.1% cache hit")
  })

  test("unknown type falls back to truncated JSON of the payload", () => {
    const payload = { foo: "a".repeat(100) }
    const e = env("span.new", payload)
    expect(summarizeEvent(e)).toBe(JSON.stringify(payload).slice(0, 80))
  })
})
