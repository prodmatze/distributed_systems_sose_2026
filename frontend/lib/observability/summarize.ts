// Pure formatting for the firehose: kind classification, chip color, and a
// one-line human summary per envelope type. Payloads are untyped wire data
// (Record<string, unknown>) so every field read here is defensive — a
// malformed or forward-incompatible payload degrades to a placeholder
// instead of throwing.
import type { Envelope } from "./types"

export type EvtKind = "http" | "chat" | "docker" | "presence" | "stats" | "other"

const BODY_MAX = 60
const UNKNOWN_MAX = 80

export function kindForType(type: string): EvtKind {
  if (type === "http.request") return "http"
  if (type === "chat.message" || type === "chat.message.summary") return "chat"
  // Emitted by the chat service itself: ws.message is a send, connect and
  // disconnect are a user attaching to or leaving a replica.
  if (type === "ws.message") return "chat"
  if (type === "ws.connect" || type === "ws.disconnect") return "presence"
  if (type.startsWith("docker.")) return "docker"
  if (type.startsWith("presence.")) return "presence"
  if (type === "db.stats" || type === "redis.stats" || type === "observer.health") return "stats"
  return "other"
}

const KIND_COLOR: Record<EvtKind, string> = {
  http: "var(--evt-http)",
  chat: "var(--evt-redis)",
  docker: "var(--svc-docker)",
  presence: "var(--evt-ws)",
  stats: "var(--evt-sql)",
  other: "var(--text-3)",
}

export function colorForKind(kind: EvtKind): string {
  return KIND_COLOR[kind]
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {}
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function summarizeEvent(e: Envelope): string {
  const p = e.payload
  switch (e.type) {
    case "http.request": {
      const method = str(p.method)
      const uri = str(p.uri)
      const status = num(p.status)
      const rtMs = num(p.rt_ms)
      return `${method} ${uri} → ${status} ${rtMs.toFixed(1)}ms`
    }
    case "chat.message": {
      const channelId = num(p.channel_id)
      const message = obj(p.message)
      const sender = str(message.sender_username, "?")
      const body = truncate(str(message.body), BODY_MAX)
      return `${sender} → #${channelId}: ${body}`
    }
    case "chat.message.summary": {
      return `▸ ${num(p.count)} messages coalesced`
    }
    case "docker.event": {
      const action = str(p.action)
      const container = str(p.container)
      const exitCode = p.exit_code
      return exitCode !== undefined && exitCode !== null && exitCode !== ""
        ? `${action} ${container} (${exitCode})`
        : `${action} ${container}`
    }
    case "docker.containers": {
      const containers = Array.isArray(p.containers) ? p.containers : []
      return `container inventory (${containers.length})`
    }
    case "docker.stats": {
      const stats = obj(p.stats)
      return `stats for ${Object.keys(stats).length} containers`
    }
    case "ws.message": {
      const who = str(p.username) || `user ${num(p.user_id)}`
      return `${who} sent to #${num(p.channel_id)} via ${str(p.replica) || "?"}`
    }
    case "ws.connect": {
      const who = str(p.username) || `user ${num(p.user_id)}`
      return `${who} connected to ${str(p.replica) || "?"}`
    }
    case "ws.disconnect": {
      const who = str(p.username) || `user ${num(p.user_id)}`
      return `${who} disconnected`
    }
    case "presence.online":
      return `user ${num(p.user_id)} online`
    case "presence.offline":
      return `user ${num(p.user_id)} offline`
    case "redis.stats": {
      const ops = num(p.ops_per_sec)
      const subs = num(p.chat_subscribers)
      return `${ops} ops/s · ${subs} subscribers`
    }
    case "db.stats": {
      const commits = num(p.commits_per_s)
      const hit = num(p.cache_hit_pct)
      return `${commits.toFixed(1)} commits/s · ${hit.toFixed(1)}% cache hit`
    }
    default: {
      const json = JSON.stringify(p) ?? "{}"
      return json.length > UNKNOWN_MAX ? json.slice(0, UNKNOWN_MAX) : json
    }
  }
}
