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
import { useCallback, useEffect, useState } from "react"

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
import { NodeDrawer } from "./node-drawer"
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
  const [nodes, setNodes, onNodesChange] = useNodesState<ObsFlowNode>(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState<Edge<ObsEdgeData>>(initialEdges)
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

  const onNodeClick = useCallback<NodeMouseHandler<ObsFlowNode>>((_, node) => {
    setSelected(node.id as ObsNodeId)
  }, [])

  return (
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
      {selected && <NodeDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

export function Topology() {
  return (
    <>
      <div className="obs-panel-title">SYSTEM TOPOLOGY</div>
      <ReactFlowProvider>
        <TopologyFlow />
      </ReactFlowProvider>
    </>
  )
}
