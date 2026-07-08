// One store owns everything the dashboard knows. Three write paths, three
// read paths, deliberately separated:
//   writes: applySnapshot (connect), ingestBatch (every ~150ms frame),
//           tick (1 Hz wall clock)
//   reads:  `derived` (React, 1 Hz), `events` (firehose only, per batch),
//           onFresh listeners (pulse/comet layers — zero React)
// Rates are computed from envelope timestamps, so tests are deterministic
// and a stalled stream decays to zero against the tick clock.
import { create } from "zustand"

import type {
  ContainerInfo,
  Envelope,
  StoredEnvelope,
  WorldSnapshot,
} from "./types"

export type ConnState = "connecting" | "live" | "reconnecting" | "closed"

export type Derived = {
  reqRate: number
  msgRate: number
  evtRate: number
  onlineUsers: number
  containersUp: number
  containersTotal: number
  replicas: number
  degraded: boolean
  containers: Record<string, ContainerInfo>
  spark: { req: number[]; msg: number[]; evt: number[] }
}

const RING_MAX = 2000
const SEEN_MAX = 6000
const SPARK_BUCKETS = 60
const DEGRADE_ON = 50 // events/s
const DEGRADE_OFF = 35
const RESUME_BADGE_MS = 5000

const EXITED_ACTIONS = new Set(["die", "stop", "kill", "oom"])
const RUNNING_ACTIONS = new Set(["start", "restart", "unpause"])

const emptyWorld = (): WorldSnapshot => ({
  containers: {},
  online_users: [],
  rates: {},
  replicas: 0,
  last_event_id: "0-0",
})

const emptyDerived = (): Derived => ({
  reqRate: 0,
  msgRate: 0,
  evtRate: 0,
  onlineUsers: 0,
  containersUp: 0,
  containersTotal: 0,
  replicas: 0,
  degraded: false,
  containers: {},
  spark: {
    req: new Array(SPARK_BUCKETS).fill(0),
    msg: new Array(SPARK_BUCKETS).fill(0),
    evt: new Array(SPARK_BUCKETS).fill(0),
  },
})

export type ObsState = {
  conn: ConnState
  mock: boolean
  resumedFrom: string | null
  world: WorldSnapshot
  events: StoredEnvelope[]
  elidedTotal: number
  derived: Derived
  selectedCorr: string | null
  lastEventId: string | null
  setConn(c: ConnState): void
  setMode(mock: boolean): void
  selectCorr(corr: string | null): void
  applySnapshot(s: WorldSnapshot): void
  ingestBatch(events: Envelope[], elided: number, nowMs?: number): void
  beginFresh(): void
  markResumed(id: string, nowMs: number): void
  tick(nowMs: number): void
  onFresh(fn: (fresh: StoredEnvelope[]) => void): () => void
}

function foldEvent(world: WorldSnapshot, e: Envelope): void {
  const p = e.payload
  switch (e.type) {
    case "docker.containers": {
      const list = Array.isArray(p.containers) ? (p.containers as Record<string, unknown>[]) : []
      const next: Record<string, ContainerInfo> = {}
      for (const c of list) {
        const name = typeof c.name === "string" ? c.name : null
        if (!name) continue
        next[name] = {
          service: (c.service as string) ?? null,
          state: (c.state as string) ?? null,
          health: (c.health as string) ?? null,
          status: (c.status as string) ?? null,
          stats: world.containers[name]?.stats ?? {},
        }
      }
      world.containers = next
      break
    }
    case "docker.event": {
      const name = typeof p.container === "string" ? p.container : null
      const action = typeof p.action === "string" ? p.action : ""
      if (!name) break
      const entry = (world.containers[name] ??= {
        service: (p.service as string) ?? null,
        state: null,
        health: null,
        status: null,
        stats: {},
      })
      if (EXITED_ACTIONS.has(action)) entry.state = "exited"
      else if (RUNNING_ACTIONS.has(action)) entry.state = "running"
      else if (action.startsWith("health_status:")) entry.health = action.split(":", 2)[1].trim()
      break
    }
    case "docker.stats": {
      const stats = typeof p.stats === "object" && p.stats !== null ? (p.stats as Record<string, ContainerInfo["stats"]>) : {}
      for (const [name, st] of Object.entries(stats)) {
        const entry = (world.containers[name] ??= { service: null, state: null, health: null, status: null, stats: {} })
        entry.stats = st
      }
      break
    }
    case "presence.online": {
      if (typeof p.user_id === "number" && !world.online_users.includes(p.user_id)) {
        world.online_users = [...world.online_users, p.user_id].sort((a, b) => a - b)
      }
      break
    }
    case "presence.offline": {
      world.online_users = world.online_users.filter((u) => u !== p.user_id)
      break
    }
    case "redis.stats": {
      if (typeof p.chat_subscribers === "number") world.replicas = p.chat_subscribers
      break
    }
  }
}

export function createObsStore() {
  const seen = new Set<string>()
  const listeners = new Set<(fresh: StoredEnvelope[]) => void>()
  let degradeHot = 0
  let degradeCool = 0
  let resumedAt = 0

  return create<ObsState>()((set, get) => ({
    conn: "connecting",
    mock: false,
    resumedFrom: null,
    world: emptyWorld(),
    events: [],
    elidedTotal: 0,
    derived: emptyDerived(),
    selectedCorr: null,
    lastEventId: null,

    setConn: (conn) => set({ conn }),
    setMode: (mock) => set({ mock }),
    selectCorr: (selectedCorr) => set({ selectedCorr }),

    applySnapshot: (s) =>
      set({ world: structuredClone(s), lastEventId: s.last_event_id }),

    ingestBatch: (batch, elided, nowMs = Date.now()) => {
      const fresh: StoredEnvelope[] = []
      for (const e of batch) {
        if (!e.id || seen.has(e.id)) continue
        seen.add(e.id)
        const tsMs = Date.parse(e.ts)
        fresh.push({ ...e, tsMs: Number.isNaN(tsMs) ? nowMs : tsMs })
      }
      if (seen.size > SEEN_MAX) {
        seen.clear()
        for (const e of get().events) seen.add(e.id)
        for (const e of fresh) seen.add(e.id)
      }
      if (fresh.length === 0 && elided === 0) return

      const world = structuredClone(get().world)
      // authoritative container list first, then everything else in order
      for (const e of fresh) if (e.type === "docker.containers") foldEvent(world, e)
      for (const e of fresh) if (e.type !== "docker.containers") foldEvent(world, e)

      const events = [...get().events, ...fresh].slice(-RING_MAX)
      const last = fresh.length ? fresh[fresh.length - 1].id : get().lastEventId
      set({
        events,
        world,
        elidedTotal: get().elidedTotal + elided,
        lastEventId: last,
      })
      if (fresh.length) for (const fn of listeners) fn(fresh)
    },

    beginFresh: () => {
      seen.clear()
      set({ events: [], elidedTotal: 0, resumedFrom: null })
    },

    markResumed: (id, nowMs) => {
      resumedAt = nowMs
      set({ resumedFrom: id })
    },

    tick: (nowMs) => {
      const { events, world } = get()
      const spark = {
        req: new Array(SPARK_BUCKETS).fill(0),
        msg: new Array(SPARK_BUCKETS).fill(0),
        evt: new Array(SPARK_BUCKETS).fill(0),
      }
      let req10 = 0
      let msg10 = 0
      let evt5 = 0
      for (const e of events) {
        const age = nowMs - e.tsMs
        if (age < 0 || age >= SPARK_BUCKETS * 1000) continue
        const bucket = SPARK_BUCKETS - 1 - Math.floor(age / 1000)
        spark.evt[bucket] += 1
        if (age < 5000) evt5 += 1
        if (e.type === "http.request") {
          spark.req[bucket] += 1
          if (age < 10_000) req10 += 1
        } else if (e.type === "chat.message") {
          spark.msg[bucket] += 1
          if (age < 10_000) msg10 += 1
        } else if (e.type === "chat.message.summary") {
          const n = typeof e.payload.count === "number" ? e.payload.count : 0
          spark.msg[bucket] += n
          if (age < 10_000) msg10 += n
        }
      }

      const evtRate = evt5 / 5
      const wasDegraded = get().derived.degraded
      if (evtRate > DEGRADE_ON) {
        degradeHot += 1
        degradeCool = 0
      } else if (evtRate < DEGRADE_OFF) {
        degradeCool += 1
        degradeHot = 0
      }
      const degraded = wasDegraded ? degradeCool < 3 : degradeHot >= 2

      const names = Object.values(world.containers)
      set({
        derived: {
          reqRate: req10 / 10,
          msgRate: msg10 / 10,
          evtRate,
          onlineUsers: world.online_users.length,
          containersUp: names.filter((c) => c.state === "running").length,
          containersTotal: names.length,
          replicas: world.replicas,
          degraded,
          containers: world.containers,
          spark,
        },
        ...(get().resumedFrom && nowMs - resumedAt > RESUME_BADGE_MS
          ? { resumedFrom: null }
          : {}),
      })
    },

    onFresh: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }))
}

export const useObsStore = createObsStore()
