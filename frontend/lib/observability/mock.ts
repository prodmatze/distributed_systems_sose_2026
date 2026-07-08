// A faithful, deterministic stand-in for the observer feed: same frame
// protocol, same envelope shapes, same failure choreography (kill →
// gap → restart → heal) looping every 60s so the dashboard can be built
// and demoed without the stack. Seeded PRNG — no Math.random, no Date.now.
import type { StreamHandlers, StreamSource } from "./source"
import type { ContainerInfo, Envelope, WorldSnapshot, WsFrame } from "./types"

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type ContainerMeta = { name: string; service: string }

// All 11 chorus-* containers the compose stack runs, chat scaled to 3 replicas.
const CONTAINERS: ContainerMeta[] = [
  { name: "chorus-gateway-1", service: "gateway" },
  { name: "chorus-api-1", service: "api" },
  { name: "chorus-auth-1", service: "auth" },
  { name: "chorus-chat-1", service: "chat" },
  { name: "chorus-chat-2", service: "chat" },
  { name: "chorus-chat-3", service: "chat" },
  { name: "chorus-postgres-1", service: "postgres" },
  { name: "chorus-redis-1", service: "redis" },
  { name: "chorus-observer-1", service: "observer" },
  { name: "chorus-socket-proxy-1", service: "socket-proxy" },
  { name: "chorus-jaeger-1", service: "jaeger" },
]

const BASE_MEM_MB: Record<string, number> = {
  gateway: 40,
  api: 95,
  auth: 60,
  chat: 75,
  postgres: 220,
  redis: 45,
  observer: 55,
  "socket-proxy": 35,
  jaeger: 130,
}

const UPSTREAM_BY_CONTAINER: Record<string, string> = {
  "chorus-api-1": "172.19.0.11",
  "chorus-auth-1": "172.19.0.12",
  "chorus-chat-1": "172.19.0.21",
  "chorus-chat-2": "172.19.0.22",
  "chorus-chat-3": "172.19.0.23",
}

const UPSTREAMS_BY_SERVICE: Record<string, string[]> = {
  api: ["172.19.0.11"],
  auth: ["172.19.0.12"],
  chat: ["172.19.0.21", "172.19.0.22", "172.19.0.23"],
}

const HTTP_ROUTES: { method: string; uri: string; service: string }[] = [
  { method: "GET", uri: "/api/channels", service: "api" },
  { method: "GET", uri: "/api/channels/1/messages", service: "api" },
  { method: "GET", uri: "/api/channels/3/messages", service: "api" },
  { method: "POST", uri: "/api/channels/2/messages", service: "api" },
  { method: "GET", uri: "/api/users/me", service: "api" },
  { method: "POST", uri: "/auth/login", service: "auth" },
  { method: "POST", uri: "/auth/refresh", service: "auth" },
  { method: "GET", uri: "/chat/ws", service: "chat" },
]

const USERNAMES = ["alice", "bob", "carol", "obs_bot_1"]
const USER_IDS: Record<string, number> = { alice: 101, bob: 102, carol: 103, obs_bot_1: 199 }
const CHAT_BODIES = [
  "anyone else seeing lag on the gateway?",
  "deploying the new build now",
  "lgtm, merging",
  "chat-2 keeps flapping again",
  "can you check the redis subscriber count",
  "meeting in 5",
  "logs look clean after the restart",
  "dashboard's live, take a look",
]
const CHANNEL_IDS = [1, 2, 3]
const PRESENCE_POOL = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 199]

function hex(rng: () => number, len: number): string {
  let s = ""
  for (let i = 0; i < len; i++) s += Math.floor(rng() * 16).toString(16)
  return s
}

// chat-2's scripted death window within the 60s loop: die at phase 20,
// back up at phase 28, health confirmed healthy at phase 30.
function isChat2Dead(phase: number): boolean {
  return phase >= 20 && phase < 28
}

export function createMockSource(opts?: { seed?: number; t0?: number; intervalMs?: number }): StreamSource {
  const t0 = opts?.t0 ?? Date.now()
  const seed = opts?.seed ?? 1
  const intervalMs = opts?.intervalMs ?? 150

  return {
    start(h: StreamHandlers): () => void {
      const rng = mulberry32(seed)

      let tMs = t0 - 60_000
      let seq = 0
      const id = () => `${tMs}-${++seq}`

      const cpu: Record<string, number> = {}
      const mem: Record<string, number> = {}
      for (const c of CONTAINERS) {
        cpu[c.name] = 4 + rng() * 10
        mem[c.name] = BASE_MEM_MB[c.service] ?? 50
      }

      const onlineUsers = new Set<number>()
      while (onlineUsers.size < 4) {
        onlineUsers.add(PRESENCE_POOL[Math.floor(rng() * PRESENCE_POOL.length)])
      }

      let msgSeq = 1000

      function env(type: string, service: string, corr: string | null, payload: Record<string, unknown>): Envelope {
        return { id: id(), type, service, ts: new Date(tMs).toISOString(), corr, payload }
      }

      function containerListEntry(c: ContainerMeta, phase: number) {
        const dead = c.name === "chorus-chat-2" && isChat2Dead(phase)
        return {
          name: c.name,
          service: c.service,
          state: dead ? "exited" : "running",
          health: dead ? null : "healthy",
          status: dead ? "Exited (137) 4 seconds ago" : "Up",
        }
      }

      function containerStatsEntry(c: ContainerMeta, phase: number, advance: boolean) {
        const dead = c.name === "chorus-chat-2" && isChat2Dead(phase)
        if (advance) {
          cpu[c.name] = Math.min(35, Math.max(2, cpu[c.name] + (rng() - 0.5) * 6))
          mem[c.name] = Math.max(10, mem[c.name] + (rng() - 0.5) * 4)
        }
        return {
          cpu_pct: dead ? 0 : Math.round(cpu[c.name] * 10) / 10,
          mem_mb: Math.round(mem[c.name] * 10) / 10,
          mem_pct: Math.round((mem[c.name] / 512) * 1000) / 10,
          rx_kb: Math.round(rng() * 300 * 10) / 10,
          tx_kb: Math.round(rng() * 300 * 10) / 10,
        }
      }

      function buildSnapshotContainers(): Record<string, ContainerInfo> {
        const out: Record<string, ContainerInfo> = {}
        for (const c of CONTAINERS) {
          out[c.name] = {
            service: c.service,
            state: "running",
            health: "healthy",
            status: "Up",
            stats: containerStatsEntry(c, 0, false),
          }
        }
        return out
      }

      function emitDockerContainers(phase: number, sink: Envelope[]) {
        sink.push(
          env("docker.containers", "docker", null, {
            containers: CONTAINERS.map((c) => containerListEntry(c, phase)),
          }),
        )
      }

      function emitDockerStats(phase: number, sink: Envelope[]) {
        const stats: Record<string, unknown> = {}
        for (const c of CONTAINERS) stats[c.name] = containerStatsEntry(c, phase, true)
        sink.push(env("docker.stats", "docker", null, { stats }))
      }

      function emitRedisStats(phase: number, sink: Envelope[]) {
        const alive = isChat2Dead(phase) ? 2 : 3
        const presence = [...onlineUsers]
          .sort((a, b) => a - b)
          .map((user_id) => ({ user_id, ttl: 10 + Math.floor(rng() * 50) }))
        const clients = CONTAINERS.filter((c) => c.service === "chat" && !(c.name === "chorus-chat-2" && isChat2Dead(phase))).map((c) => ({
          name: c.name,
          addr: `${UPSTREAM_BY_CONTAINER[c.name]}:6379`,
          cmd: "PSUBSCRIBE",
        }))
        sink.push(
          env("redis.stats", "redis", null, {
            chat_subscribers: alive,
            ops_per_sec: Math.round(50 + rng() * 350),
            connected_clients: alive + 2,
            numpat: alive * 2 + 1,
            presence,
            clients,
          }),
        )
      }

      function emitDbStats(sink: Envelope[]) {
        sink.push(
          env("db.stats", "postgres", null, {
            commits_per_s: Math.round((5 + rng() * 35) * 10) / 10,
            cache_hit_pct: Math.round((90 + rng() * 9.8) * 10) / 10,
            queries: [
              { query: "select * from messages where channel_id = $1 order by id desc limit 50", ms: Math.round(rng() * 12 * 10) / 10 },
              { query: "select * from users where id = $1", ms: Math.round(rng() * 3 * 10) / 10 },
              { query: "insert into messages (...) values (...)", ms: Math.round(rng() * 8 * 10) / 10 },
            ],
            connections: [
              { app: "api", state: "active", n: 1 + Math.floor(rng() * 4) },
              { app: "auth", state: "idle", n: 1 + Math.floor(rng() * 2) },
              { app: "chat", state: "active", n: 1 + Math.floor(rng() * 3) },
            ],
          }),
        )
      }

      function emitHttp(phase: number, sink: Envelope[]) {
        const burst = phase >= 40 && phase < 46
        const count = burst ? 80 : 6
        for (let i = 0; i < count; i++) {
          const route = HTTP_ROUTES[Math.floor(rng() * HTTP_ROUTES.length)]
          const pool = UPSTREAMS_BY_SERVICE[route.service] ?? ["172.19.0.10"]
          const upstreamPool =
            route.service === "chat" && isChat2Dead(phase) ? pool.filter((ip) => ip !== UPSTREAM_BY_CONTAINER["chorus-chat-2"]) : pool
          const upstream = upstreamPool[Math.floor(rng() * upstreamPool.length)]
          const roll = rng()
          const status = roll < 0.02 ? 401 : roll < 0.04 ? 404 : 200
          sink.push(
            env("http.request", route.service, hex(rng, 16), {
              method: route.method,
              uri: route.uri,
              status,
              rt_ms: Math.round((2 + rng() * 38) * 10) / 10,
              upstream,
              remote: `10.0.${Math.floor(rng() * 4)}.${Math.floor(rng() * 254) + 1}`,
            }),
          )
        }
      }

      function emitChat(sink: Envelope[]) {
        for (let i = 0; i < 2; i++) {
          const username = USERNAMES[Math.floor(rng() * USERNAMES.length)]
          const channel_id = CHANNEL_IDS[Math.floor(rng() * CHANNEL_IDS.length)]
          msgSeq += 1
          sink.push(
            env("chat.message", "chat", null, {
              channel_id,
              message: {
                type: "message",
                id: msgSeq,
                channel_id,
                sender_id: USER_IDS[username],
                sender_username: username,
                body: CHAT_BODIES[Math.floor(rng() * CHAT_BODIES.length)],
                created_at: new Date(tMs).toISOString(),
              },
            }),
          )
        }
      }

      function emitPresence(sink: Envelope[]) {
        if (rng() >= 0.02) return
        if (onlineUsers.size > 2 && rng() < 0.5) {
          const arr = [...onlineUsers]
          const user_id = arr[Math.floor(rng() * arr.length)]
          onlineUsers.delete(user_id)
          sink.push(env("presence.offline", "chat", null, { user_id }))
          return
        }
        const candidates = PRESENCE_POOL.filter((u) => !onlineUsers.has(u))
        const user_id = candidates.length
          ? candidates[Math.floor(rng() * candidates.length)]
          : PRESENCE_POOL[Math.floor(rng() * PRESENCE_POOL.length)]
        onlineUsers.add(user_id)
        sink.push(env("presence.online", "chat", null, { user_id }))
      }

      function emitDockerEvent(phase: number, sink: Envelope[]) {
        if (phase === 20) {
          sink.push(env("docker.event", "docker", null, { action: "die", container: "chorus-chat-2", service: "chat", exit_code: "137" }))
        } else if (phase === 28) {
          sink.push(env("docker.event", "docker", null, { action: "start", container: "chorus-chat-2", service: "chat" }))
        } else if (phase === 30) {
          sink.push(env("docker.event", "docker", null, { action: "health_status: healthy", container: "chorus-chat-2", service: "chat" }))
        }
      }

      // Everything that can happen in one wall-second, gated on tMs (fires
      // during history too) and on phase (scripted windows — negative
      // during history, so they never fire there).
      function emitSecond(phase: number, sink: Envelope[]) {
        emitHttp(phase, sink)
        emitChat(sink)
        if (tMs % 5000 === 0) sink.push(env("chat.message.summary", "chat", null, { count: 8 + Math.floor(rng() * 13) }))
        if (tMs % 2000 === 0) {
          emitDockerStats(phase, sink)
          emitRedisStats(phase, sink)
          emitDbStats(sink)
        }
        if (tMs % 3000 === 0) emitDockerContainers(phase, sink)
        emitDockerEvent(phase, sink)
        emitPresence(sink)
      }

      let nextSecond = t0 - 60_000
      function drainThrough(limitMs: number, sink: Envelope[]) {
        while (nextSecond <= limitMs) {
          tMs = nextSecond
          const phase = ((tMs - t0) / 1000) % 60
          emitSecond(phase, sink)
          nextSecond += 1000
        }
      }

      h.onStatus("connecting")
      h.onConnect(null)

      const snapshot: WorldSnapshot = {
        containers: buildSnapshotContainers(),
        online_users: [...onlineUsers].sort((a, b) => a - b),
        rates: { http: 6, chat: 2 },
        replicas: 3,
        last_event_id: `${t0 - 60_000}-0`,
      }
      h.onFrame({ type: "snapshot", state: snapshot } satisfies WsFrame)

      const history: Envelope[] = []
      drainThrough(t0 - 1000, history)
      h.onFrame({ type: "batch", events: history.slice(-300), elided: 0 } satisfies WsFrame)

      h.onStatus("live")

      let elapsed = t0
      const timer = setInterval(() => {
        elapsed += intervalMs
        const batch: Envelope[] = []
        drainThrough(elapsed, batch)
        if (batch.length) h.onFrame({ type: "batch", events: batch, elided: 0 } satisfies WsFrame)
      }, intervalMs)

      return () => clearInterval(timer)
    },
  }
}
