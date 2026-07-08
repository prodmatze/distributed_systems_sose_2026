import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { createWsSource } from "@/lib/observability/ws-source"
import type { ConnState } from "@/lib/observability/store"
import type { WsFrame } from "@/lib/observability/types"

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
}

let lastId: string | null = null
const statuses: ConnState[] = []
const frames: WsFrame[] = []
const connects: (string | null)[] = []

function startSource() {
  return createWsSource("ws://test/observer/ws").start({
    onFrame: (f) => frames.push(f),
    onStatus: (s) => statuses.push(s),
    onConnect: (r) => connects.push(r),
    resumeFrom: () => lastId,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", FakeWebSocket)
  FakeWebSocket.instances = []
  statuses.length = frames.length = connects.length = 0
  lastId = null
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("ws source", () => {
  test("first connect is fresh (no resume_from), dispatches parsed frames", () => {
    lastId = "55-0"
    const stop = startSource()
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toBe("ws://test/observer/ws")
    ws.open()
    expect(connects).toEqual([null])
    expect(statuses).toContain("live")
    ws.onmessage?.({ data: JSON.stringify({ type: "batch", events: [], elided: 1 }) })
    expect(frames).toHaveLength(1)
    ws.onmessage?.({ data: "garbage" })
    expect(frames).toHaveLength(1)
    stop()
  })

  test("quick reconnect resumes from last id", () => {
    const stop = startSource()
    FakeWebSocket.instances[0].open()
    lastId = "99-3"
    FakeWebSocket.instances[0].close()
    expect(statuses).toContain("reconnecting")
    vi.advanceTimersByTime(500)
    const ws2 = FakeWebSocket.instances[1]
    expect(ws2.url).toBe("ws://test/observer/ws?resume_from=99-3")
    ws2.open()
    expect(connects).toEqual([null, "99-3"])
    stop()
  })

  test("long outage reconnects fresh", () => {
    const stop = startSource()
    FakeWebSocket.instances[0].open()
    lastId = "99-3"
    FakeWebSocket.instances[0].close()
    // fail every attempt; the outage clock starts at the FIRST close, so
    // once total elapsed passes 30s the next attempt must drop resume_from
    for (let i = 0; i < 8; i++) {
      const cur = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      if (cur.readyState === 0) cur.close()
      vi.advanceTimersByTime(10_000)
    }
    const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    expect(last.url).toBe("ws://test/observer/ws")
    last.open()
    expect(connects[connects.length - 1]).toBeNull()
    stop()
  })

  test("backoff doubles and caps at 10s", () => {
    const stop = startSource()
    FakeWebSocket.instances[0].open()
    FakeWebSocket.instances[0].close()
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(10_000)
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1].close()
    }
    const count = FakeWebSocket.instances.length
    vi.advanceTimersByTime(9_999)
    expect(FakeWebSocket.instances.length).toBe(count)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances.length).toBe(count + 1)
    stop()
  })

  test("stop() prevents further reconnects", () => {
    const stop = startSource()
    FakeWebSocket.instances[0].open()
    stop()
    const count = FakeWebSocket.instances.length
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances.length).toBe(count)
    expect(statuses[statuses.length - 1]).toBe("closed")
  })
})
