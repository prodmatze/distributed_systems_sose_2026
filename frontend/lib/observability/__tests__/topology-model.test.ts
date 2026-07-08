import { describe, expect, test } from "vitest"

import {
  TOPO_EDGES,
  TOPO_NODES,
  arcRing,
  containerToNode,
  makeSlotAllocator,
  nodeStateFor,
  nodeToContainer,
  routeForEvent,
  type ObsNodeId,
} from "@/lib/observability/topology-model"
import type { Envelope } from "@/lib/observability/types"

function env(type: string, service: string, payload: Record<string, unknown>): Envelope {
  return { id: "1720374000123-0", type, service, ts: "2026-07-08T18:42:08.501Z", corr: null, payload }
}

describe("containerToNode", () => {
  test("maps every container-backed name to its node id", () => {
    expect(containerToNode("chorus-gateway-1")).toBe("gateway")
    expect(containerToNode("chorus-api-1")).toBe("api")
    expect(containerToNode("chorus-auth-1")).toBe("auth")
    expect(containerToNode("chorus-chat-1")).toBe("chat-1")
    expect(containerToNode("chorus-chat-2")).toBe("chat-2")
    expect(containerToNode("chorus-chat-3")).toBe("chat-3")
    expect(containerToNode("chorus-postgres-1")).toBe("postgres")
    expect(containerToNode("chorus-redis-1")).toBe("redis")
  })

  test("infrastructure containers have no node", () => {
    expect(containerToNode("chorus-observer-1")).toBeNull()
    expect(containerToNode("chorus-socket-proxy-1")).toBeNull()
    expect(containerToNode("chorus-jaeger-1")).toBeNull()
  })

  test("unknown / malformed names are null, never throw", () => {
    expect(containerToNode("chorus-chat-9")).toBeNull()
    expect(containerToNode("chorus-gateway")).toBeNull()
    expect(containerToNode("random")).toBeNull()
    expect(containerToNode("")).toBeNull()
  })
})

describe("nodeToContainer", () => {
  test("inverse for container-backed nodes", () => {
    expect(nodeToContainer("gateway")).toBe("chorus-gateway-1")
    expect(nodeToContainer("api")).toBe("chorus-api-1")
    expect(nodeToContainer("auth")).toBe("chorus-auth-1")
    expect(nodeToContainer("chat-1")).toBe("chorus-chat-1")
    expect(nodeToContainer("chat-2")).toBe("chorus-chat-2")
    expect(nodeToContainer("chat-3")).toBe("chorus-chat-3")
    expect(nodeToContainer("postgres")).toBe("chorus-postgres-1")
    expect(nodeToContainer("redis")).toBe("chorus-redis-1")
  })

  test("browser has no container", () => {
    expect(nodeToContainer("browser")).toBeNull()
  })

  test("round-trips against containerToNode for every container-backed node", () => {
    for (const n of TOPO_NODES) {
      const container = nodeToContainer(n.id)
      if (container) expect(containerToNode(container)).toBe(n.id)
    }
  })
})

describe("makeSlotAllocator", () => {
  test("three distinct ips get slots 1, 2, 3 in first-seen order", () => {
    const slot = makeSlotAllocator()
    expect(slot("172.19.0.21")).toBe(1)
    expect(slot("172.19.0.22")).toBe(2)
    expect(slot("172.19.0.23")).toBe(3)
  })

  test("same ip always resolves to the same slot", () => {
    const slot = makeSlotAllocator()
    slot("172.19.0.21")
    slot("172.19.0.22")
    expect(slot("172.19.0.21")).toBe(1)
    expect(slot("172.19.0.22")).toBe(2)
    expect(slot("172.19.0.21")).toBe(1)
  })

  test("a fourth distinct ip wraps round-robin to slot 1", () => {
    const slot = makeSlotAllocator()
    slot("a")
    slot("b")
    slot("c")
    expect(slot("d")).toBe(1)
    expect(slot("e")).toBe(2)
  })
})

describe("routeForEvent", () => {
  const noSlot = () => 1

  test("http.request to a single-instance upstream lights gateway → service", () => {
    expect(routeForEvent(env("http.request", "api", { upstream: "172.19.0.11" }), noSlot)).toEqual({
      nodes: ["gateway", "api"],
      color: "var(--evt-http)",
    })
    expect(routeForEvent(env("http.request", "auth", { upstream: "172.19.0.12" }), noSlot)).toEqual({
      nodes: ["gateway", "auth"],
      color: "var(--evt-http)",
    })
  })

  test("http.request to chat resolves the replica slot from the upstream ip", () => {
    const slot = makeSlotAllocator()
    const a = routeForEvent(env("http.request", "chat", { upstream: "172.19.0.21" }), slot)
    const b = routeForEvent(env("http.request", "chat", { upstream: "172.19.0.22" }), slot)
    const c = routeForEvent(env("http.request", "chat", { upstream: "172.19.0.23" }), slot)
    const aAgain = routeForEvent(env("http.request", "chat", { upstream: "172.19.0.21" }), slot)
    expect(a).toEqual({ nodes: ["gateway", "chat-1"], color: "var(--evt-http)" })
    expect(b).toEqual({ nodes: ["gateway", "chat-2"], color: "var(--evt-http)" })
    expect(c).toEqual({ nodes: ["gateway", "chat-3"], color: "var(--evt-http)" })
    expect(aAgain).toEqual({ nodes: ["gateway", "chat-1"], color: "var(--evt-http)" })
  })

  test("chat.message and its summary light redis in the pub/sub hue", () => {
    expect(routeForEvent(env("chat.message", "chat", {}), noSlot)).toEqual({
      nodes: ["redis"],
      color: "var(--evt-redis)",
    })
    expect(routeForEvent(env("chat.message.summary", "chat", { count: 12 }), noSlot)).toEqual({
      nodes: ["redis"],
      color: "var(--evt-redis)",
    })
  })

  test("presence events light redis in the websocket hue", () => {
    expect(routeForEvent(env("presence.online", "chat", { user_id: 7 }), noSlot)).toEqual({
      nodes: ["redis"],
      color: "var(--evt-ws)",
    })
    expect(routeForEvent(env("presence.offline", "chat", { user_id: 7 }), noSlot)).toEqual({
      nodes: ["redis"],
      color: "var(--evt-ws)",
    })
  })

  test("docker.event colors by action — crit for exited, ok for running", () => {
    for (const action of ["die", "stop", "kill", "oom"]) {
      expect(routeForEvent(env("docker.event", "docker", { action, container: "chorus-chat-2" }), noSlot)).toEqual({
        nodes: ["chat-2"],
        color: "var(--status-crit)",
      })
    }
    for (const action of ["start", "restart", "unpause"]) {
      expect(routeForEvent(env("docker.event", "docker", { action, container: "chorus-chat-2" }), noSlot)).toEqual({
        nodes: ["chat-2"],
        color: "var(--status-ok)",
      })
    }
  })

  test("docker.event on an untracked container routes to no node", () => {
    const r = routeForEvent(env("docker.event", "docker", { action: "die", container: "chorus-observer-1" }), noSlot)
    expect(r.nodes).toEqual([])
  })

  test("unmapped event types route nowhere", () => {
    expect(routeForEvent(env("db.stats", "postgres", {}), noSlot).nodes).toEqual([])
    expect(routeForEvent(env("redis.stats", "redis", {}), noSlot).nodes).toEqual([])
    expect(routeForEvent(env("span.new", "observer", {}), noSlot).nodes).toEqual([])
  })
})

describe("nodeStateFor", () => {
  test("maps docker container state strings to the node state enum", () => {
    expect(nodeStateFor("running")).toBe("running")
    expect(nodeStateFor("exited")).toBe("exited")
    expect(nodeStateFor("restarting")).toBe("unknown")
    expect(nodeStateFor("paused")).toBe("unknown")
    expect(nodeStateFor(null)).toBe("unknown")
  })
})

describe("arcRing", () => {
  test("running + healthy is a full emerald ring", () => {
    const ring = arcRing("running", "healthy")
    expect(ring.cardBg).toBeNull()
    expect(ring.segments).toEqual([{ color: "var(--status-ok)", fraction: 1 }])
  })

  test("running with no health reported is still a full emerald ring", () => {
    expect(arcRing("running", null).segments).toEqual([{ color: "var(--status-ok)", fraction: 1 }])
  })

  test("running but not healthy is a warn/ok split ring", () => {
    for (const health of ["unhealthy", "starting"]) {
      expect(arcRing("running", health).segments).toEqual([
        { color: "var(--status-warn)", fraction: 0.5 },
        { color: "var(--status-ok)", fraction: 0.5 },
      ])
    }
  })

  test("exited is a full red ring and dims the card", () => {
    const ring = arcRing("exited", null)
    expect(ring.segments).toEqual([{ color: "var(--status-crit)", fraction: 1 }])
    expect(ring.cardBg).toBe("var(--status-crit-dim)")
  })

  test("unknown is a full idle ring", () => {
    expect(arcRing("unknown", null).segments).toEqual([{ color: "var(--status-idle)", fraction: 1 }])
  })

  test("fractions always sum to 1", () => {
    const cases: [Parameters<typeof arcRing>[0], string | null][] = [
      ["running", "healthy"],
      ["running", null],
      ["running", "unhealthy"],
      ["exited", null],
      ["unknown", null],
    ]
    for (const [state, health] of cases) {
      const sum = arcRing(state, health).segments.reduce((a, s) => a + s.fraction, 0)
      expect(sum).toBeCloseTo(1)
    }
  })
})

describe("TOPO_NODES / TOPO_EDGES integrity", () => {
  test("node layout matches the documented coordinates", () => {
    const byId = Object.fromEntries(TOPO_NODES.map((n) => [n.id, n]))
    expect(byId.browser).toMatchObject({ x: 0, y: 240, external: true })
    expect(byId.gateway).toMatchObject({ x: 210, y: 240 })
    expect(byId.auth).toMatchObject({ x: 430, y: 40 })
    expect(byId.api).toMatchObject({ x: 430, y: 160 })
    expect(byId["chat-1"]).toMatchObject({ x: 430, y: 320 })
    expect(byId["chat-2"]).toMatchObject({ x: 430, y: 430 })
    expect(byId["chat-3"]).toMatchObject({ x: 430, y: 540 })
    expect(byId.postgres).toMatchObject({ x: 700, y: 130 })
    expect(byId.redis).toMatchObject({ x: 700, y: 430 })
  })

  test("there are exactly nine nodes", () => {
    expect(TOPO_NODES).toHaveLength(9)
  })

  test("every edge references nodes that exist", () => {
    const ids = new Set<ObsNodeId>(TOPO_NODES.map((n) => n.id))
    for (const e of TOPO_EDGES) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })

  test("edge ids follow the e:source:target convention", () => {
    for (const e of TOPO_EDGES) {
      expect(e.id).toBe(`e:${e.source}:${e.target}`)
    }
  })

  test("the wiring matches ARCHITECTURE §2", () => {
    const wiring = TOPO_EDGES.map((e) => `${e.source}->${e.target}`).sort()
    expect(wiring).toEqual(
      [
        "browser->gateway",
        "gateway->auth",
        "gateway->api",
        "gateway->chat-1",
        "gateway->chat-2",
        "gateway->chat-3",
        "auth->postgres",
        "api->postgres",
        "api->redis",
        "chat-1->postgres",
        "chat-2->postgres",
        "chat-3->postgres",
        "chat-1->redis",
        "chat-2->redis",
        "chat-3->redis",
      ].sort(),
    )
  })
})
