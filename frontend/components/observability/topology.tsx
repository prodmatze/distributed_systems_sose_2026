// The topology canvas. Loaded via next/dynamic(ssr:false) from the page so
// xyflow never enters the chat bundle. Nodes are a controlled array kept in
// useNodesState (so React Flow owns measurement/position) whose data is
// refreshed from derived.containers on the store's 1 Hz tick — the only thing
// that re-renders this tree. Per-event work (Task 10/12) drives the DOM
// directly and must never flow back through here. Attribution stays visible
// (free tier): we deliberately do not pass proOptions.hideAttribution.
"use client"

import "@xyflow/react/dist/style.css"

import {
  Background,
  Controls,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { quantizeRate } from "@/lib/observability/fold-display"
import { useObsStore } from "@/lib/observability/store"
import {
  nodeStateFor,
  nodeToContainer,
  TOPO_EDGES,
  TOPO_NODES,
  type ObsNodeId,
  type TopoNode,
  type TopoNodeDatum,
} from "@/lib/observability/topology-model"
import type { ContainerInfo } from "@/lib/observability/types"

import { AnimatedSvgEdge, type ObsEdgeData } from "./animated-edge"
import { CometCanvas } from "./comet-canvas"
import { NodeDrawer } from "./node-drawer"
import { attachPulseRouter } from "./pulse-layer"
import { TopologyNode, type ObsFlowNode } from "./topology-node"

// Stable references — React Flow warns and thrashes if these are rebuilt.
const nodeTypes = { obs: TopologyNode }
const edgeTypes = { obs: AnimatedSvgEdge }

function datumFor(node: TopoNode, containers: Record<string, ContainerInfo>): TopoNodeDatum {
  if (node.external) {
    return { label: node.label, service: node.service, external: true, state: "running", health: null, cpu: null, mem: null }
  }
  const name = nodeToContainer(node.id)
  const info = name ? containers[name] : undefined
  return {
    label: node.label,
    service: node.service,
    state: nodeStateFor(info?.state ?? null),
    health: info?.health ?? null,
    cpu: info?.stats.cpu_pct ?? null,
    mem: info?.stats.mem_pct ?? null,
  }
}

const initialNodes: ObsFlowNode[] = TOPO_NODES.map((n) => ({
  id: n.id,
  type: "obs",
  position: { x: n.x, y: n.y },
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  draggable: false,
  data: datumFor(n, {}),
}))

const initialEdges: Edge<ObsEdgeData>[] = TOPO_EDGES.map((e) => ({
  id: e.id,
  source: e.source,
  target: e.target,
  type: "obs",
  data: {},
}))

const TOPO_BY_ID = new Map<ObsNodeId, TopoNode>(TOPO_NODES.map((n) => [n.id, n]))

function TopologyFlow() {
  const containers = useObsStore((s) => s.derived.containers)
  const degraded = useObsStore((s) => s.derived.degraded)
  const evtRate = useObsStore((s) => s.derived.evtRate)
  const [nodes, setNodes, onNodesChange] = useNodesState<ObsFlowNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<ObsEdgeData>>(initialEdges)
  const [selected, setSelected] = useState<ObsNodeId | null>(null)
  const [followMode, setFollowMode] = useState(false)

  // 1 Hz: fold fresh container state into node data, preserving measurement.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const topo = TOPO_BY_ID.get(n.id as ObsNodeId)
        return topo ? { ...n, data: datumFor(topo, containers) } : n
      }),
    )
  }, [containers, setNodes])

  // Same 1 Hz derived subscription drives the edges: flowMode swaps the idle
  // SMIL dot for marching dashes, rate (quantized — see fold-display.ts) sets
  // the dot's cadence. Quantizing before the effect dependency (not just
  // before the SVG prop) means the effect itself only re-fires on a regime
  // shift, not every tick — matches quantizeRate's whole purpose.
  const rate = useMemo(() => quantizeRate(evtRate), [evtRate])
  useEffect(() => {
    setEdges((eds) => eds.map((e) => ({ ...e, data: { flowMode: degraded, rate } })))
  }, [degraded, rate, setEdges])

  const onNodeClick = useCallback<NodeMouseHandler<ObsFlowNode>>((_, node) => {
    setSelected(node.id as ObsNodeId)
  }, [])

  // Router lives entirely outside React: subscribes to onFresh once, drives
  // DOM pulses directly per batch, detaches on unmount.
  useEffect(() => attachPulseRouter(), [])

  return (
    <>
      <div className="obs-panel-title">
        SYSTEM TOPOLOGY
        <button
          type="button"
          className="obs-chip"
          aria-pressed={followMode}
          onClick={() => setFollowMode((v) => !v)}
          style={{
            marginLeft: "auto",
            cursor: "pointer",
            color: followMode ? "var(--accent)" : "var(--text-2)",
            borderColor: followMode ? "var(--accent-border)" : "var(--border-1)",
            background: followMode ? "var(--accent-dim)" : "transparent",
          }}
        >
          ⌁ FOLLOW
        </button>
      </div>
      <div className="obs-topo-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={22} size={1} color="var(--border-1)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <CometCanvas followMode={followMode} />
        {selected && <NodeDrawer id={selected} onClose={() => setSelected(null)} />}
      </div>
    </>
  )
}

export function Topology() {
  return (
    <ReactFlowProvider>
      <TopologyFlow />
    </ReactFlowProvider>
  )
}
