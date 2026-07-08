import { describe, expect, test } from "vitest"

import { isEnvelope, parseFrame } from "@/lib/observability/types"

const env = {
  id: "1720374008137-0",
  type: "docker.event",
  service: "docker",
  ts: "2026-07-07T18:42:08.137Z",
  corr: null,
  payload: { action: "die", container: "chorus-chat-2", exit_code: "137" },
}

describe("parseFrame", () => {
  test("parses a snapshot frame and fills defaults", () => {
    const f = parseFrame(JSON.stringify({ type: "snapshot", state: { replicas: 3 } }))
    expect(f).not.toBeNull()
    if (f?.type !== "snapshot") throw new Error("expected snapshot")
    expect(f.state.replicas).toBe(3)
    expect(f.state.containers).toEqual({})
    expect(f.state.online_users).toEqual([])
    expect(f.state.last_event_id).toBe("0-0")
  })

  test("parses a batch frame", () => {
    const f = parseFrame(JSON.stringify({ type: "batch", events: [env], elided: 2 }))
    if (f?.type !== "batch") throw new Error("expected batch")
    expect(f.events).toHaveLength(1)
    expect(f.events[0].id).toBe(env.id)
    expect(f.elided).toBe(2)
  })

  test("drops malformed events inside a batch, keeps the rest", () => {
    const f = parseFrame(JSON.stringify({ type: "batch", events: [env, { nope: true }, 42], elided: 0 }))
    if (f?.type !== "batch") throw new Error("expected batch")
    expect(f.events).toHaveLength(1)
  })

  test("returns null for garbage", () => {
    expect(parseFrame("not json")).toBeNull()
    expect(parseFrame(JSON.stringify({ type: "wat" }))).toBeNull()
    expect(parseFrame(12 as unknown as string)).toBeNull()
    expect(parseFrame(JSON.stringify(null))).toBeNull()
  })

  test("unknown envelope types survive parsing (forward compatibility)", () => {
    const weird = { ...env, type: "span.new.thing", payload: { anything: [1, 2] } }
    const f = parseFrame(JSON.stringify({ type: "batch", events: [weird], elided: 0 }))
    if (f?.type !== "batch") throw new Error("expected batch")
    expect(f.events[0].type).toBe("span.new.thing")
  })
})

test("isEnvelope tolerates missing corr/service", () => {
  expect(isEnvelope({ id: "1-0", type: "x", ts: "2026-01-01T00:00:00Z" })).toBe(true)
  expect(isEnvelope({ id: 5, type: "x", ts: "t" })).toBe(false)
})
