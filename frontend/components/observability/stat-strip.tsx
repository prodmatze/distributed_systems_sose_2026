"use client"

import { useObsStore } from "@/lib/observability/store"

import { StatTile } from "./stat-tile"

export function StatStrip() {
  const d = useObsStore((s) => s.derived)
  return (
    <div style={{ display: "flex", gap: "var(--space-3)" }}>
      <StatTile label="req / s" value={d.reqRate.toFixed(1)} spark={d.spark.req} sparkColor="var(--evt-http)" />
      <StatTile label="msg / s" value={d.msgRate.toFixed(1)} spark={d.spark.msg} sparkColor="var(--evt-redis)" />
      <StatTile label="events / s" value={d.evtRate.toFixed(1)} spark={d.spark.evt}>
        {d.degraded && (
          <span className="obs-chip" style={{ color: "var(--status-warn)", borderColor: "var(--status-warn)" }}>
            FLOW MODE
          </span>
        )}
      </StatTile>
      <StatTile label="online" value={String(d.onlineUsers)} />
      <StatTile label="containers" value={`${d.containersUp}/${d.containersTotal}`} alert={d.containersUp < d.containersTotal} />
      <StatTile label="replicas" value={`×${d.replicas}`} accent />
    </div>
  )
}
