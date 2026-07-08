// The custom React Flow node: a flat mission-control card. Its live surface is
// the status arc-ring (derived purely from state+health) and a continuous CPU
// glow. The glow is a pre-rendered ::after shadow in obs.css whose *opacity*
// binds to the --glow CSS var — we never animate box-shadow itself. The
// obs-pulse span and the data-obs-node handle are the seams Task 10 animates;
// they render inert here.
import { SiNginx, SiPostgresql, SiRedis } from "@icons-pack/react-simple-icons"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { Boxes, Globe, KeyRound, MessagesSquare } from "lucide-react"

import { arcRing, type TopoNodeDatum } from "@/lib/observability/topology-model"

import { MicroBar } from "./micro-bar"

export type ObsFlowNode = Node<TopoNodeDatum, "obs">

type IconComponent = React.ComponentType<{ size?: number; color?: string }>

const SERVICE_ICON: Record<string, IconComponent> = {
  browser: Globe,
  gateway: SiNginx,
  auth: KeyRound,
  api: Boxes,
  chat: MessagesSquare,
  postgres: SiPostgresql,
  redis: SiRedis,
}

// 18px ring; r=7 leaves room for a 2px stroke inside the box.
const RING = 18
const R = 7
const C = 2 * Math.PI * R

function ArcRing({ datum }: { datum: TopoNodeDatum }) {
  const { segments } = arcRing(datum.state, datum.health)
  // Cumulative start offset per segment, computed purely (no render-time
  // mutation). Segment counts are ≤2 so the slice/reduce cost is nil.
  const lengths = segments.map((s) => s.fraction * C)
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0))
  return (
    <svg className="obs-node-ring" width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
      <g transform={`rotate(-90 ${RING / 2} ${RING / 2})`}>
        <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke="var(--border-1)" strokeWidth={2} />
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx={RING / 2}
            cy={RING / 2}
            r={R}
            fill="none"
            stroke={seg.color}
            strokeWidth={2}
            strokeDasharray={`${lengths[i]} ${C - lengths[i]}`}
            strokeDashoffset={-starts[i]}
            strokeLinecap="butt"
          />
        ))}
      </g>
    </svg>
  )
}

export function TopologyNode({ id, data }: NodeProps<ObsFlowNode>) {
  const { cardBg } = arcRing(data.state, data.health)
  const Icon = SERVICE_ICON[data.service] ?? Globe
  const iconColor = `var(--svc-${data.service}, var(--text-2))`
  // Continuous glow tracks CPU: full at ~50% and above, off at idle.
  const glow = data.cpu === null ? 0 : Math.min(Math.max(data.cpu / 50, 0), 1)

  return (
    <div
      data-obs-node={id}
      className="obs-node"
      style={{ "--glow": String(glow), ...(cardBg ? { background: cardBg } : {}) } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="obs-node-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="obs-node-handle" isConnectable={false} />

      <span className="obs-node-bracket obs-node-bracket-tl" aria-hidden="true" />
      <span className="obs-node-bracket obs-node-bracket-br" aria-hidden="true" />

      <div className="obs-node-head">
        <Icon size={14} color={iconColor} />
        <span className="obs-node-label obs-num">{data.label}</span>
        <ArcRing datum={data} />
      </div>

      {!data.external && (
        <div className="obs-node-metrics">
          <MicroBar label="CPU" value={data.cpu} max={100} unit="%" color="var(--accent)" />
          <MicroBar label="MEM" value={data.mem} max={100} unit="%" color="var(--svc-api)" />
        </div>
      )}

      <span className="obs-pulse" aria-hidden="true" />
    </div>
  )
}
