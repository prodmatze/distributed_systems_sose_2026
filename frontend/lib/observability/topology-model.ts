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

// The one shared instance. It lives here, in lib, rather than beside the
// components that first needed it, because the pulses, the comets, the edges,
// the drawer AND the event feed all have to agree on which visual replica an
// address maps to. Two allocators would silently disagree.
export const slotForUpstream = makeSlotAllocator()

// "172.18.0.9:8000" or "172.18.0.9" → "chat-2". Ports are stripped so an
// address reported by nginx and the same address reported by the replica itself
// resolve identically.
export function replicaLabel(addr: unknown): string {
  if (typeof addr !== "string" || addr === "") return "?"
  return `chat-${slotForUpstream(addr.split(":")[0])}`
}

const EXITED_ACTIONS = new Set(["die", "stop", "kill", "oom"])

export type EventRoute = { nodes: ObsNodeId[]; color: string }

export function edgeId(source: ObsNodeId, target: ObsNodeId): string {
  return `e:${source}:${target}`
}

const CHAT_NODE_LIST: ObsNodeId[] = ["chat-1", "chat-2", "chat-3"]

// Which *wires* an envelope travelled, as opposed to which nodes it lights
// (routeForEvent). Each edge is then animated at its own measured rate instead
// of every edge sharing one global number — a gateway→auth hop must not make
// chat-3→redis twitch.
//
// Only edges we can genuinely attribute are returned. The *→postgres wires are
// deliberately absent: the nginx log stops at the gateway hop and the chan:*
// tap cannot say which replica performed the INSERT, so there is no honest
// per-request signal for them. They stay quiet rather than animate on a guess.
export type EdgeHit = { id: string; reverse: boolean }

export function edgesForEvent(e: Envelope, slotForUpstream: (ip: string) => number): EdgeHit[] {
  if (e.type === "http.request") {
    let target: ObsNodeId | null
    if (e.service === "chat") {
      const ip = typeof e.payload.upstream === "string" ? e.payload.upstream : ""
      target = `chat-${slotForUpstream(ip)}` as ObsNodeId
    } else {
      target = SINGLE_SERVICE_NODE[e.service] ?? null
    }
    // Every gateway hop crossed the browser→gateway wire to get there. Both
    // travel in the declared source→target direction: browser to gateway to
    // service, which is how the request really moves.
    const edges: EdgeHit[] = [{ id: edgeId("browser", "gateway"), reverse: false }]
    if (target && target !== "gateway") edges.push({ id: edgeId("gateway", target), reverse: false })
    return edges
  }

  // The send path: the frame crossed the gateway to a replica, which then
  // published it. This is the half of the message journey the outside-in taps
  // cannot see, so it only exists because chat announces it.
  if (e.type === "ws.message") {
    const replica = replicaNode(e.payload.replica, slotForUpstream)
    return [
      { id: edgeId("browser", "gateway"), reverse: false },
      { id: edgeId("gateway", replica), reverse: false },
      { id: edgeId(replica, "redis"), reverse: false },
    ]
  }

  if (e.type === "ws.connect" || e.type === "ws.disconnect") {
    const replica = replicaNode(e.payload.replica, slotForUpstream)
    return [
      { id: edgeId("browser", "gateway"), reverse: false },
      { id: edgeId("gateway", replica), reverse: false },
    ]
  }

  // A published chat message is a FANOUT: Redis pushes it to every replica
  // holding the `chan:*` pattern. The wires are declared chat→redis for layout,
  // so the fanout has to be drawn travelling backwards along them, otherwise
  // the picture claims messages flow into Redis and never come out — which is
  // the exact opposite of what pub/sub does, and the whole point of the demo.
  if (e.type === "chat.message" || e.type === "chat.message.summary") {
    return CHAT_NODE_LIST.map((n) => ({ id: edgeId(n, "redis"), reverse: true }))
  }

  // Presence is the other direction for real: a replica writes presence:<uid>
  // with a TTL, and the keyspace notification is the echo of that write.
  if (e.type.startsWith("presence.")) {
    return CHAT_NODE_LIST.map((n) => ({ id: edgeId(n, "redis"), reverse: false }))
  }

  return []
}

// Periodic pollers. They are real events, but they arrive on a fixed cadence
// whether or not anything is happening, so in a "what has this node been doing"
// list they would bury every event that actually means something.
const POLL_TYPES = new Set([
  "db.stats",
  "redis.stats",
  "docker.stats",
  "docker.containers",
  "observer.health",
])

// Does this envelope represent activity ON this node? Reuses routeForEvent so
// the drawer, the pulses and the edges can never disagree about which replica
// served a request.
export function isNodeActivity(
  e: Envelope,
  id: ObsNodeId,
  slotForUpstream: (ip: string) => number,
): boolean {
  if (POLL_TYPES.has(e.type)) return false
  // routeForEvent starts an http.request chain at the gateway, because that is
  // the first node that *handled* it. But every one of those requests was made
  // by a client, which is exactly what the browser node stands for, so it needs
  // its own rule or its drawer can never match anything.
  if (id === "browser") return e.type === "http.request" || e.type.startsWith("ws.")
  return routeForEvent(e, slotForUpstream).nodes.includes(id)
}

// One-line human summary of an event, for the node drawer. Every payload read
// is defensive — the observer forwards producer payloads verbatim.
export function describeEvent(e: Envelope): string {
  const p = e.payload
  if (e.type === "http.request") {
    const method = typeof p.method === "string" ? p.method : "?"
    const uri = typeof p.uri === "string" ? p.uri : "?"
    const status = typeof p.status === "number" ? p.status : "?"
    const ms = typeof p.rt_ms === "number" ? ` · ${p.rt_ms.toFixed(0)}ms` : ""
    return `${method} ${uri} → ${status}${ms}`
  }
  if (e.type === "chat.message") {
    const msg = (p.message ?? {}) as Record<string, unknown>
    const who = typeof msg.sender_username === "string" ? msg.sender_username : "?"
    const body = typeof msg.body === "string" ? msg.body : ""
    return `fanout · ${who}: ${body}`
  }
  if (e.type === "ws.message") {
    return `sent by ${p.username ?? p.user_id ?? "?"} → #${p.channel_id ?? "?"}`
  }
  if (e.type === "ws.connect") {
    return `${p.username ?? p.user_id ?? "?"} connected`
  }
  if (e.type === "ws.disconnect") {
    return `${p.username ?? p.user_id ?? "?"} disconnected`
  }
  if (e.type === "chat.message.summary") {
    const n = typeof p.count === "number" ? p.count : 0
    return `${n} messages (folded)`
  }
  if (e.type.startsWith("presence.")) {
    const user = p.user_id ?? p.user ?? "?"
    return `user ${user} ${e.type.slice("presence.".length)}`
  }
  if (e.type === "docker.event") {
    const action = typeof p.action === "string" ? p.action : "?"
    const code = p.exit_code ? ` (${p.exit_code})` : ""
    return `${action}${code}`
  }
  return e.type
}

// Smoothed per-edge events/s → a 0–4 activity level. Quantized on purpose:
// browsers restart <animateMotion> whenever `dur` changes, so a continuously
// varying duration would reset the dot every tick. Level 0 means *silent* —
// the edge renders as a bare hairline, so "nothing moving" honestly means
// "nothing measured on this wire".
export function edgeLevel(rate: number): 0 | 1 | 2 | 3 | 4 {
  if (rate < 0.15) return 0
  if (rate < 1) return 1
  if (rate < 5) return 2
  if (rate < 20) return 3
  return 4
}

// Which nodes a single envelope should light, and in what hue. Pure given the
// slot allocator (which the caller owns so slots persist across events). Every
// field read off the untyped payload is defensive.
// nginx reports an upstream as "172.18.0.9:8000"; a chat replica announcing
// itself reports "172.18.0.9". Strip the port so both resolve to the SAME slot,
// otherwise a request and the message it carried would light different replicas.
function replicaNode(addr: unknown, slotForUpstream: (ip: string) => number): ObsNodeId {
  const ip = typeof addr === "string" ? addr.split(":")[0] : ""
  return `chat-${slotForUpstream(ip)}` as ObsNodeId
}

export function routeForEvent(e: Envelope, slotForUpstream: (ip: string) => number): EventRoute {
  if (e.type === "http.request") {
    let target: ObsNodeId | null
    if (e.service === "chat") {
      target = replicaNode(e.payload.upstream, slotForUpstream)
    } else {
      target = SINGLE_SERVICE_NODE[e.service] ?? null
    }
    return { nodes: target ? ["gateway", target] : ["gateway"], color: "var(--evt-http)" }
  }

  // Emitted by the chat service itself — the WebSocket hop nothing outside the
  // process can observe. ws.message continues on to Redis, because publishing is
  // what the replica does next with the frame it just accepted.
  if (e.type === "ws.message") {
    return {
      nodes: ["gateway", replicaNode(e.payload.replica, slotForUpstream), "redis"],
      color: "var(--evt-ws)",
    }
  }
  if (e.type === "ws.connect" || e.type === "ws.disconnect") {
    return { nodes: ["gateway", replicaNode(e.payload.replica, slotForUpstream)], color: "var(--evt-ws)" }
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
