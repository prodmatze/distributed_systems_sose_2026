// The topology's data model: the fixed node/edge graph of the Chorus stack
// and the pure functions that map live wire data onto it. Everything here is
// deterministic and side-effect free (the one exception, makeSlotAllocator,
// returns a closure that owns its own state) so it can be unit-tested without
// React or the store. Component contracts (Task 10/11) depend on these exact
// shapes — see .superpowers/sdd/task-9-brief.md.
import type { Envelope } from "./types"

export type ObsNodeId =
  | "browser"
  | "gateway"
  | "auth"
  | "api"
  | "chat-1"
  | "chat-2"
  | "chat-3"
  | "postgres"
  | "redis"

export type NodeState = "running" | "exited" | "unknown"

export type TopoNodeDatum = {
  label: string
  service: string
  external?: boolean
  state: NodeState
  health: string | null
  cpu: number | null
  mem: number | null
}

export type TopoNode = {
  id: ObsNodeId
  x: number
  y: number
  service: string
  label: string
  external?: boolean
}

export type TopoEdge = { id: string; source: ObsNodeId; target: ObsNodeId }

// Flow coordinates, left→right. Layout is fixed (nodesDraggable={false}); the
// canvas fits these on mount. Mirrors the layout table in the task brief.
export const TOPO_NODES: TopoNode[] = [
  { id: "browser", x: 0, y: 240, service: "browser", label: "browser", external: true },
  { id: "gateway", x: 210, y: 240, service: "gateway", label: "gateway" },
  { id: "auth", x: 430, y: 40, service: "auth", label: "auth" },
  { id: "api", x: 430, y: 160, service: "api", label: "api" },
  { id: "chat-1", x: 430, y: 320, service: "chat", label: "chat-1" },
  { id: "chat-2", x: 430, y: 430, service: "chat", label: "chat-2" },
  { id: "chat-3", x: 430, y: 540, service: "chat", label: "chat-3" },
  { id: "postgres", x: 700, y: 130, service: "postgres", label: "postgres" },
  { id: "redis", x: 700, y: 430, service: "redis", label: "redis" },
]

// Request flow, matching ARCHITECTURE.md §2. Edge id encodes its endpoints so
// per-event routing can address an edge by name without a lookup table.
const WIRING: [ObsNodeId, ObsNodeId][] = [
  ["browser", "gateway"],
  ["gateway", "auth"],
  ["gateway", "api"],
  ["gateway", "chat-1"],
  ["gateway", "chat-2"],
  ["gateway", "chat-3"],
  ["auth", "postgres"],
  ["api", "postgres"],
  ["api", "redis"],
  ["chat-1", "postgres"],
  ["chat-2", "postgres"],
  ["chat-3", "postgres"],
  ["chat-1", "redis"],
  ["chat-2", "redis"],
  ["chat-3", "redis"],
]

export const TOPO_EDGES: TopoEdge[] = WIRING.map(([source, target]) => ({
  id: `e:${source}:${target}`,
  source,
  target,
}))

// Single-instance services whose container name is `chorus-<service>-1`.
const SINGLE_SERVICE_NODE: Record<string, ObsNodeId> = {
  gateway: "gateway",
  auth: "auth",
  api: "api",
  postgres: "postgres",
  redis: "redis",
}

const CHAT_NODES = new Set<ObsNodeId>(["chat-1", "chat-2", "chat-3"])

// "chorus-chat-2" → "chat-2", "chorus-gateway-1" → "gateway". Infrastructure
// containers (observer/socket-proxy/jaeger) and anything malformed → null.
export function containerToNode(name: string): ObsNodeId | null {
  const m = /^chorus-(.+)-(\d+)$/.exec(name)
  if (!m) return null
  const [, service, index] = m
  if (service === "chat") {
    const id = `chat-${index}` as ObsNodeId
    return CHAT_NODES.has(id) ? id : null
  }
  return SINGLE_SERVICE_NODE[service] ?? null
}

// Inverse of containerToNode for container-backed nodes; browser → null.
export function nodeToContainer(id: ObsNodeId): string | null {
  if (id === "browser") return null
  if (CHAT_NODES.has(id)) return `chorus-${id}` // chat-2 → chorus-chat-2
  return `chorus-${id}-1`
}

// Collapse a docker container state string into the three states the ring
// cares about; unknown/paused/restarting all read as "unknown".
export function nodeStateFor(state: string | null): NodeState {
  if (state === "running") return "running"
  if (state === "exited") return "exited"
  return "unknown"
}

// Stable, first-seen round-robin over chat replica slots 1..3. The observer
// never tells us which physical replica an upstream ip is, so we assign each
// new ip the next visual slot and remember it — same ip, same slot, forever.
export function makeSlotAllocator(): (ip: string) => number {
  const slots = new Map<string, number>()
  let seen = 0
  return (ip: string) => {
    const cached = slots.get(ip)
    if (cached !== undefined) return cached
    const slot = (seen % 3) + 1
    seen += 1
    slots.set(ip, slot)
    return slot
  }
}

const EXITED_ACTIONS = new Set(["die", "stop", "kill", "oom"])

export type EventRoute = { nodes: ObsNodeId[]; color: string }

// Which nodes a single envelope should light, and in what hue. Pure given the
// slot allocator (which the caller owns so slots persist across events). Every
// field read off the untyped payload is defensive.
export function routeForEvent(e: Envelope, slotForUpstream: (ip: string) => number): EventRoute {
  if (e.type === "http.request") {
    let target: ObsNodeId | null
    if (e.service === "chat") {
      const ip = typeof e.payload.upstream === "string" ? e.payload.upstream : ""
      target = `chat-${slotForUpstream(ip)}` as ObsNodeId
    } else {
      target = SINGLE_SERVICE_NODE[e.service] ?? null
    }
    return { nodes: target ? ["gateway", target] : ["gateway"], color: "var(--evt-http)" }
  }

  if (e.type === "chat.message" || e.type === "chat.message.summary") {
    return { nodes: ["redis"], color: "var(--evt-redis)" }
  }

  if (e.type.startsWith("presence.")) {
    return { nodes: ["redis"], color: "var(--evt-ws)" }
  }

  if (e.type === "docker.event") {
    const container = typeof e.payload.container === "string" ? e.payload.container : ""
    const action = typeof e.payload.action === "string" ? e.payload.action : ""
    const node = containerToNode(container)
    const color = EXITED_ACTIONS.has(action) ? "var(--status-crit)" : "var(--status-ok)"
    return { nodes: node ? [node] : [], color }
  }

  return { nodes: [], color: "var(--text-3)" }
}

export type ArcSegment = { color: string; fraction: number }
export type ArcRing = { segments: ArcSegment[]; cardBg: string | null }

// The status ring around a node card. Segments' fractions always sum to 1 so
// the caller can lay them out as stroke-dasharray slices of the circumference.
// exited additionally tints the whole card.
export function arcRing(state: NodeState, health: string | null): ArcRing {
  if (state === "exited") {
    return { segments: [{ color: "var(--status-crit)", fraction: 1 }], cardBg: "var(--status-crit-dim)" }
  }
  if (state === "running") {
    if (health === null || health === "healthy") {
      return { segments: [{ color: "var(--status-ok)", fraction: 1 }], cardBg: null }
    }
    return {
      segments: [
        { color: "var(--status-warn)", fraction: 0.5 },
        { color: "var(--status-ok)", fraction: 0.5 },
      ],
      cardBg: null,
    }
  }
  return { segments: [{ color: "var(--status-idle)", fraction: 1 }], cardBg: null }
}
