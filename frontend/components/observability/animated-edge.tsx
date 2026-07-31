// Hand-vendored edge (no React Flow registry fetch).
//
// The edge itself carries no particles. Individual events are drawn by the
// comet overlay (comet-canvas.tsx), one comet per real event, so a second
// animated layer on the same wires would only compete with it for attention.
// What survives here is a static cue: a wire that is currently carrying
// measured traffic is drawn brighter than an idle one, which is information the
// comets cannot convey (they are transient, the brightness persists).
//
// In flowMode (system-wide overload) the path becomes a marching-ants accent
// line, which is also when comets stand down.
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react"

export type ObsEdgeData = {
  flowMode?: boolean
  /** Measured traffic level 0-4, source → target. */
  level?: number
  /** Measured traffic level 0-4, target → source (e.g. a Redis fanout). */
  levelReverse?: number
}

export function AnimatedSvgEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({ ...props })
  const data = (props.data ?? {}) as ObsEdgeData
  const active = (data.level ?? 0) > 0 || (data.levelReverse ?? 0) > 0

  return (
    <BaseEdge
      id={props.id}
      path={path}
      className={data.flowMode ? "obs-edge-flow" : active ? "obs-edge obs-edge-live" : "obs-edge"}
    />
  )
}
