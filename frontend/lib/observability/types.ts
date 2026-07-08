// Shapes of the observer WS feed (see docs/observability/README.md, "The
// event envelope" + "Consuming the feed"). Parsing is deliberately tolerant:
// unknown event types must flow through untouched, malformed ones are
// dropped row-by-row, and a bad frame is null — never an exception.

export type Envelope = {
  id: string
  type: string
  service: string
  ts: string
  corr: string | null
  payload: Record<string, unknown>
}

export type StoredEnvelope = Envelope & { tsMs: number }

export type ContainerStats = {
  cpu_pct?: number
  mem_mb?: number
  mem_pct?: number
  rx_kb?: number
  tx_kb?: number
}

export type ContainerInfo = {
  service: string | null
  state: string | null
  health: string | null
  status: string | null
  stats: ContainerStats
}

export type WorldSnapshot = {
  containers: Record<string, ContainerInfo>
  online_users: number[]
  rates: Record<string, number>
  replicas: number
  last_event_id: string
}

export type SnapshotFrame = { type: "snapshot"; state: WorldSnapshot }
export type BatchFrame = { type: "batch"; events: Envelope[]; elided: number }
export type WsFrame = SnapshotFrame | BatchFrame

export function isEnvelope(v: unknown): v is Envelope {
  if (typeof v !== "object" || v === null) return false
  const e = v as Record<string, unknown>
  return typeof e.id === "string" && typeof e.type === "string" && typeof e.ts === "string"
}

function normalizeEnvelope(e: Envelope): Envelope {
  return {
    id: e.id,
    type: e.type,
    service: typeof e.service === "string" ? e.service : "",
    ts: e.ts,
    corr: typeof e.corr === "string" ? e.corr : null,
    payload:
      typeof e.payload === "object" && e.payload !== null
        ? (e.payload as Record<string, unknown>)
        : {},
  }
}

export function parseFrame(raw: unknown): WsFrame | null {
  if (typeof raw !== "string") return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null) return null
  const d = data as Record<string, unknown>

  if (d.type === "snapshot" && typeof d.state === "object" && d.state !== null) {
    const s = d.state as Record<string, unknown>
    return {
      type: "snapshot",
      state: {
        containers:
          typeof s.containers === "object" && s.containers !== null
            ? (s.containers as Record<string, ContainerInfo>)
            : {},
        online_users: Array.isArray(s.online_users)
          ? s.online_users.filter((u): u is number => typeof u === "number")
          : [],
        rates:
          typeof s.rates === "object" && s.rates !== null
            ? (s.rates as Record<string, number>)
            : {},
        replicas: typeof s.replicas === "number" ? s.replicas : 0,
        last_event_id: typeof s.last_event_id === "string" ? s.last_event_id : "0-0",
      },
    }
  }

  if (d.type === "batch" && Array.isArray(d.events)) {
    return {
      type: "batch",
      events: d.events.filter(isEnvelope).map(normalizeEnvelope),
      elided: typeof d.elided === "number" ? d.elided : 0,
    }
  }

  return null
}
