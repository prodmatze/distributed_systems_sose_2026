// Hand-vendored animated edge (SMIL, no React Flow registry fetch). In its
// idle state it draws a hairline with a single dot drifting along the path at
// a rate-derived cadence; in flowMode the path itself becomes a marching-ants
// accent line (CSS keyframes in obs.css). The SMIL dur is quantized upstream
// (Task 12) because browsers restart animateMotion whenever dur changes.
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react"

export type ObsEdgeData = { flowMode?: boolean; rate?: number }

export function AnimatedSvgEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({ ...props })
  const data = (props.data ?? {}) as ObsEdgeData
  return (
    <>
      <BaseEdge id={props.id} path={path} className={data.flowMode ? "obs-edge-flow" : "obs-edge"} />
      {!data.flowMode && (
        <circle className="obs-edge-dot" r="2.5" fill="var(--accent)" opacity="0.7">
          <animateMotion dur={`${Math.max(1.2, 6 - (data.rate ?? 0) / 4)}s`} repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  )
}
