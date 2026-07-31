// Hand-vendored animated edge (SMIL, no React Flow registry fetch).
//
// The dot is driven by THIS edge's own measured traffic (topology.tsx feeds a
// per-edge level, see edgesForEvent/edgeLevel). Level 0 draws a bare hairline
// with no dot at all — silence on a wire means nothing was measured on it,
// which is the whole point of an observability view. Higher levels add dots and
// shorten the lap, so volume reads at a glance without one-particle-per-event.
//
// Levels are quantized upstream because browsers restart animateMotion whenever
// `dur` changes; a continuously varying duration would reset the dot each tick.
// In flowMode (system-wide overload) the path itself becomes a marching-ants
// accent line and the dots step aside.
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react"

export type ObsEdgeData = {
  flowMode?: boolean
  /** Traffic travelling source → target. */
  level?: number
  /** Traffic travelling target → source, e.g. a Redis fanout to the replicas. */
  levelReverse?: number
}

// Three dots per direction are ALWAYS mounted and always animating at a fixed
// duration. Only their opacity and radius change with the measured rate.
//
// This matters because SMIL is unforgiving about both alternatives:
//   * unmounting a dot when a wire goes quiet deletes it mid-flight, so it
//     visibly disappears halfway along the path;
//   * changing `dur` restarts animateMotion, so every dot snaps back to the
//     start whenever the rate crosses a bucket boundary.
// Keeping the elements and the timing constant removes both. Intensity is
// carried by how many dots are lit and how bright they are, and opacity is
// transitioned in CSS so a wire going quiet fades out instead of blinking.
const LAP = 2.4
const MAX_DOTS = 3

// level → [visible dots, opacity, radius]
const LOOK: Record<number, [number, number, number]> = {
  0: [0, 0, 2.5],
  1: [1, 0.55, 2.2],
  2: [2, 0.75, 2.5],
  3: [3, 0.9, 2.8],
  4: [3, 1, 3.4],
}

function Dots({ path, level, reverse }: { path: string; level: number; reverse: boolean }) {
  const [visible, opacity, r] = LOOK[level] ?? LOOK[0]
  return (
    <>
      {Array.from({ length: MAX_DOTS }, (_, i) => (
        // Negative begin offsets space the dots evenly around one lap instead of
        // stacking them. keyPoints 1;0 walks the same path backwards, which is
        // how the fanout direction is drawn without duplicating every edge.
        <circle
          key={i}
          className="obs-edge-dot"
          r={r}
          fill={reverse ? "var(--evt-redis)" : "var(--accent)"}
          opacity={i < visible ? opacity : 0}
        >
          <animateMotion
            dur={`${LAP}s`}
            begin={`-${((LAP / MAX_DOTS) * i).toFixed(2)}s`}
            repeatCount="indefinite"
            path={path}
            {...(reverse ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" } : {})}
          />
        </circle>
      ))}
    </>
  )
}

export function AnimatedSvgEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({ ...props })
  const data = (props.data ?? {}) as ObsEdgeData
  const clamp = (n: number | undefined) => Math.max(0, Math.min(4, Math.round(n ?? 0)))
  const fwd = clamp(data.level)
  const rev = clamp(data.levelReverse)
  const active = fwd > 0 || rev > 0

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        className={data.flowMode ? "obs-edge-flow" : active ? "obs-edge obs-edge-live" : "obs-edge"}
      />
      {/* Rendered unconditionally (level 0 is simply invisible) so that a wire
          falling quiet fades rather than deleting a dot mid-path. */}
      {!data.flowMode && <Dots path={path} level={fwd} reverse={false} />}
      {!data.flowMode && <Dots path={path} level={rev} reverse />}
    </>
  )
}
