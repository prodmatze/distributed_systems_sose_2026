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
import { useCallback, useEffect, useRef, useState } from "react"

import { useObsStore } from "@/lib/observability/store"
import {
  edgeLevel,
  edgesForEvent,
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
// The SAME allocator the pulses and comets use — a request must light the node
// and the wire that lead to it, not two different replicas.
import { attachPulseRouter, slotForUpstream } from "./pulse-layer"
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

// EWMA weight for per-edge rates. 0.5 halves a spike in one tick — responsive
// enough to see a burst start, damped enough that the level does not flap
// between two buckets on every sample.
const EDGE_SMOOTHING = 0.5

function TopologyFlow() {
  const containers = useObsStore((s) => s.derived.containers)
  const [nodes, setNodes, onNodesChange] = useNodesState<ObsFlowNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<ObsEdgeData>>(initialEdges)
  const [selected, setSelected] = useState<ObsNodeId | null>(null)

  // 1 Hz: fold fresh container state into node data, preserving measurement.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const topo = TOPO_BY_ID.get(n.id as ObsNodeId)
        return topo ? { ...n, data: datumFor(topo, containers) } : n
      }),
    )
  }, [containers, setNodes])

  // Per-edge traffic. Counting happens outside React (the onFresh listener
  // fires per batch and must never re-render this tree); the 1 Hz timer below
  // turns those counts into a smoothed, quantized level per edge.
  const edgeCounts = useRef(new Map<string, number>())
  const edgeRates = useRef(new Map<string, number>())
  const lastKey = useRef("")

  useEffect(
    () =>
      useObsStore.getState().onFresh((fresh) => {
        const counts = edgeCounts.current
        for (const env of fresh) {
          for (const hit of edgesForEvent(env, slotForUpstream)) {
            // Directions are counted separately: one wire can carry a publish
            // one way and a fanout the other at the same time.
            const key = hit.reverse ? `${hit.id}|r` : `${hit.id}|f`
            counts.set(key, (counts.get(key) ?? 0) + 1)
          }
        }
      }),
    [],
  )

  useEffect(() => {
    const timer = setInterval(() => {
      const counts = edgeCounts.current
      const rates = edgeRates.current
      const degraded = useObsStore.getState().derived.degraded

      const levels = new Map<string, number>()
      for (const e of TOPO_EDGES) {
        for (const dir of ["f", "r"] as const) {
          const key = `${e.id}|${dir}`
          const instant = counts.get(key) ?? 0
          const prev = rates.get(key) ?? 0
          const next = prev * (1 - EDGE_SMOOTHING) + instant * EDGE_SMOOTHING
          // Snap to zero rather than decay forever, so an idle wire actually
          // reaches the silent level instead of hovering just above it.
          rates.set(key, next < 0.05 ? 0 : next)
          levels.set(key, edgeLevel(next))
        }
      }
      counts.clear()

      // Only touch React Flow when a bucket actually moved — otherwise every
      // tick would rebuild all 15 edges and restart their SMIL animations.
      const key = `${degraded}|${TOPO_EDGES.map((e) => `${levels.get(`${e.id}|f`)}${levels.get(`${e.id}|r`)}`).join(",")}`
      if (key === lastKey.current) return
      lastKey.current = key
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          data: {
            flowMode: degraded,
            level: levels.get(`${e.id}|f`) ?? 0,
            levelReverse: levels.get(`${e.id}|r`) ?? 0,
          },
        })),
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [setEdges])

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
        <CometCanvas />
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
