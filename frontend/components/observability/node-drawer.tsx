// Detail overlay for a clicked node — an absolute panel pinned to the right of
// the topology canvas. It reads container info and the event ring off the
// store; the narrow `events` selector is fine here because the drawer is only
// mounted while a node is selected. Esc/outside-click closing is out of scope.
import { X } from "lucide-react"
import { useMemo } from "react"

import { useObsStore } from "@/lib/observability/store"
import {
  arcRing,
  describeEvent,
  isNodeActivity,
  nodeToContainer,
  nodeStateFor,
  TOPO_NODES,
  type ObsNodeId,
} from "@/lib/observability/topology-model"

import { slotForUpstream } from "./pulse-layer"
import { ServiceBadge } from "./service-badge"

function fmt(value: number | undefined, unit: string): string {
  return typeof value === "number" ? `${value.toFixed(unit === "%" ? 0 : 1)}${unit}` : "—"
}

function num(v: unknown, digits = 1): string {
  return typeof v === "number" ? v.toFixed(digits) : "—"
}

// Newest payload of a given type still in the ring, or undefined.
function latestPayload(
  events: { type: string; payload: Record<string, unknown> }[],
  type: string,
): Record<string, unknown> | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === type) return events[i].payload
  }
  return undefined
}

export function NodeDrawer({ id, onClose }: { id: ObsNodeId; onClose: () => void }) {
  const topo = TOPO_NODES.find((n) => n.id === id)
  const containerName = nodeToContainer(id)
  const info = useObsStore((s) => (containerName ? s.derived.containers[containerName] : undefined))
  const events = useObsStore((s) => s.events)

  // What this node has actually been doing — requests it served, messages it
  // fanned out, lifecycle events. Periodic pollers are excluded upstream, so a
  // busy replica shows traffic instead of the old "no docker events".
  const activity = useMemo(
    () => events.filter((e) => isNodeActivity(e, id, slotForUpstream)).slice(-8).reverse(),
    [events, id],
  )

  // Postgres and Redis are not per-request instrumented, so instead of an empty
  // list they show the newest real stat sample: live SQL and pub/sub state.
  const db = useMemo(() => (id === "postgres" ? latestPayload(events, "db.stats") : undefined), [events, id])
  const redis = useMemo(() => (id === "redis" ? latestPayload(events, "redis.stats") : undefined), [events, id])
  const topQueries = Array.isArray(db?.queries) ? (db.queries as Record<string, unknown>[]).slice(0, 4) : []

  const state = nodeStateFor(info?.state ?? null)
  const health = info?.health ?? null
  const pillColor =
    state === "exited" ? "var(--status-crit)" : arcRing(state, health).segments[0].color
  const stats = info?.stats ?? {}

  return (
    <aside className="obs-drawer" aria-label={`${id} detail`}>
      <div className="obs-drawer-head">
        <span className="obs-num obs-drawer-name">{containerName ?? topo?.label ?? id}</span>
        <button type="button" className="obs-drawer-close" onClick={onClose} aria-label="close">
          <X size={14} />
        </button>
      </div>

      <div className="obs-drawer-row">
        <ServiceBadge service={topo?.service ?? "?"} />
        <span className="obs-chip" style={{ color: pillColor, borderColor: pillColor }}>
          {state}
          {health ? ` · ${health}` : ""}
        </span>
        {topo?.external && <span className="obs-chip">external</span>}
      </div>

      {!topo?.external && (
        <div className="obs-drawer-stats">
          <div>
            <span className="obs-micro">CPU</span>
            <span className="obs-num">{fmt(stats.cpu_pct, "%")}</span>
          </div>
          <div>
            <span className="obs-micro">MEM</span>
            <span className="obs-num">{fmt(stats.mem_mb, " MB")}</span>
          </div>
          <div>
            <span className="obs-micro">RX</span>
            <span className="obs-num">{fmt(stats.rx_kb, " KB")}</span>
          </div>
          <div>
            <span className="obs-micro">TX</span>
            <span className="obs-num">{fmt(stats.tx_kb, " KB")}</span>
          </div>
        </div>
      )}

      {redis && (
        <div className="obs-drawer-stats">
          <div>
            <span className="obs-micro">OPS/S</span>
            <span className="obs-num">{num(redis.ops_per_sec, 0)}</span>
          </div>
          <div>
            <span className="obs-micro">SUBSCRIBERS</span>
            <span className="obs-num">{num(redis.chat_subscribers, 0)}</span>
          </div>
          <div>
            <span className="obs-micro">CLIENTS</span>
            <span className="obs-num">{num(redis.connected_clients, 0)}</span>
          </div>
          <div>
            <span className="obs-micro">PRESENCE KEYS</span>
            <span className="obs-num">
              {Array.isArray(redis.presence) ? redis.presence.length : "—"}
            </span>
          </div>
        </div>
      )}

      {db && (
        <div className="obs-drawer-stats">
          <div>
            <span className="obs-micro">COMMITS/S</span>
            <span className="obs-num">{num(db.commits_per_s)}</span>
          </div>
          <div>
            <span className="obs-micro">INSERTS/S</span>
            <span className="obs-num">{num(db.inserts_per_s)}</span>
          </div>
          <div>
            <span className="obs-micro">CACHE HIT</span>
            <span className="obs-num">{num(db.cache_hit_pct, 0)}%</span>
          </div>
          <div>
            <span className="obs-micro">CONNS</span>
            <span className="obs-num">
              {Array.isArray(db.connections) ? db.connections.length : "—"}
            </span>
          </div>
        </div>
      )}

      {topQueries.length > 0 && (
        <div className="obs-drawer-events">
          <span className="obs-micro">TOP QUERIES (calls/s · mean ms)</span>
          <ul>
            {topQueries.map((q, i) => (
              <li key={i} className="obs-num obs-drawer-query">
                <span className="obs-drawer-sql" title={String(q.query ?? "")}>
                  {String(q.query ?? "")}
                </span>
                <span className="obs-drawer-ts">
                  {num(q.calls_per_s)} · {num(q.mean_ms, 2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="obs-drawer-events">
        <span className="obs-micro">RECENT ACTIVITY</span>
        {activity.length === 0 ? (
          <span className="obs-drawer-empty">
            {id === "postgres" || id === "redis"
              ? "no per-request instrumentation on this node — see stats above"
              : "nothing yet — start the simulation or send a chat message"}
          </span>
        ) : (
          <ul>
            {activity.map((e) => (
              <li key={e.id} className="obs-num">
                <span className="obs-drawer-action">{describeEvent(e)}</span>
                <span className="obs-drawer-ts">
                  {new Date(e.tsMs).toLocaleTimeString(undefined, { hour12: false })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
