// Detail overlay for a clicked node — an absolute panel pinned to the right of
// the topology canvas. It reads container info and the event ring off the
// store; the narrow `events` selector is fine here because the drawer is only
// mounted while a node is selected. Esc/outside-click closing is out of scope.
import { X } from "lucide-react"
import { useMemo } from "react"

import { useObsStore } from "@/lib/observability/store"
import { arcRing, nodeToContainer, nodeStateFor, TOPO_NODES, type ObsNodeId } from "@/lib/observability/topology-model"

import { ServiceBadge } from "./service-badge"

function fmt(value: number | undefined, unit: string): string {
  return typeof value === "number" ? `${value.toFixed(unit === "%" ? 0 : 1)}${unit}` : "—"
}

export function NodeDrawer({ id, onClose }: { id: ObsNodeId; onClose: () => void }) {
  const topo = TOPO_NODES.find((n) => n.id === id)
  const containerName = nodeToContainer(id)
  const info = useObsStore((s) => (containerName ? s.derived.containers[containerName] : undefined))
  const events = useObsStore((s) => s.events)

  const dockerEvents = useMemo(() => {
    if (!containerName) return []
    return events
      .filter((e) => e.type === "docker.event" && e.payload.container === containerName)
      .slice(-5)
      .reverse()
  }, [events, containerName])

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

      <div className="obs-drawer-events">
        <span className="obs-micro">RECENT EVENTS</span>
        {dockerEvents.length === 0 ? (
          <span className="obs-drawer-empty">no docker events</span>
        ) : (
          <ul>
            {dockerEvents.map((e) => {
              const action = typeof e.payload.action === "string" ? e.payload.action : "?"
              return (
                <li key={e.id} className="obs-num">
                  <span className="obs-drawer-action">{action}</span>
                  <span className="obs-drawer-ts">
                    {new Date(e.tsMs).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
