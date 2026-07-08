// The request comet overlay — the "follow a request through the system" hero.
// ONE <canvas> absolutely covering the React Flow pane, driven by a single rAF
// loop that runs ONLY while comets are alive. Zero React per frame: comets,
// LUTs, the viewport transform and the resolved colors all live in refs. The
// canvas paints in flow coordinates (ctx.setTransform applies xyflow's
// [x, y, zoom] each frame) so the edge-path LUTs — sampled straight off the DOM
// — line up with the nodes regardless of pan/zoom.
//
// A comet is a bright head plus a short fading trail travelling one or more
// hops at 380 ms/hop. Three choreographies feed it (see the event router
// below): a corr-matched trace chain (browser→gateway→service), the
// chat.message fanout (redis→chat-1..3), and FOLLOW mode's ambient sampling of
// http.request traffic.
"use client"

import { useNodesInitialized, useStore } from "@xyflow/react"
import { useEffect, useRef } from "react"

import { useObsStore } from "@/lib/observability/store"
import { routeForEvent, TOPO_EDGES, type ObsNodeId } from "@/lib/observability/topology-model"
import type { StoredEnvelope } from "@/lib/observability/types"

import { slotForUpstream } from "./pulse-layer"

export type Point = { x: number; y: number }

// ── Pure LUT math (unit-tested; see __tests__/comet.test.ts) ──────────────

// Sample an evenly-spaced lookup table at t∈[0,1] with linear interpolation.
// t clamps to the endpoints (t<0 → first, t>1 → last). The LUT is treated as
// equal-arc samples so t maps directly onto the sample index space.
export function sampleLut(lut: Point[], t: number): Point {
  const n = lut.length
  if (n === 0) return { x: 0, y: 0 }
  if (n === 1 || t <= 0) return lut[0]
  if (t >= 1) return lut[n - 1]
  const pos = t * (n - 1)
  const i = Math.floor(pos)
  const frac = pos - i
  const a = lut[i]
  const b = lut[i + 1]
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }
}

// Sample `samples` points evenly along an SVG path via its geometry API. Only
// callable in a real browser — jsdom has neither getTotalLength nor
// getPointAtLength, which is why the buildLut test is skipped there.
export function buildLut(path: SVGPathElement, samples = 64): Point[] {
  const total = path.getTotalLength()
  const out: Point[] = []
  const last = Math.max(samples - 1, 1)
  for (let i = 0; i < samples; i++) {
    const p = path.getPointAtLength((i / last) * total)
    out.push({ x: p.x, y: p.y })
  }
  return out
}

// ── Comet model ───────────────────────────────────────────────────────────

type Segment = { lut: Point[]; reversed: boolean }
type CometOrigin = "trace" | "fanout" | "follow"
type Comet = {
  segments: Segment[]
  startMs: number // -1 until the first frame stamps it with the rAF clock
  color: string
  origin: CometOrigin
}

const HOP_MS = 380
const TRAIL = 8 // fading samples behind the head
const HEAD_R = 3.5 // flow-space radius; scales with zoom
const HEAD_BLUR = 12
const TRAIL_STEP = 0.05 // global-progress spacing between trail samples
const PARTICLES_PER_COMET = TRAIL + 1
const MAX_PARTICLES = 512 // hard cap — kill-demo bursts stay smooth
const MAX_FOLLOW_COMETS = 4 // FOLLOW mode: at most 4 concurrent
const FOLLOW_EVERY = 4 // sample every ~4th http.request
const TAU = Math.PI * 2

// Position of a comet at global progress g∈[0,1] across all its hops. Reversed
// segments (a hop that rides a forward edge backwards) sample the LUT 1→0.
function posAt(comet: Comet, g: number): Point {
  const count = comet.segments.length
  const scaled = g * count
  let idx = Math.floor(scaled)
  if (idx >= count) idx = count - 1
  const localT = scaled - idx
  const seg = comet.segments[idx]
  return sampleLut(seg.lut, seg.reversed ? 1 - localT : localT)
}

// ── Component ───────────────────────────────────────────────────────────────

export function CometCanvas({ followMode }: { followMode: boolean }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cometsRef = useRef<Comet[]>([])
  const lutsRef = useRef<Map<string, Point[]>>(new Map())
  const rafRef = useRef<number | null>(null)
  const dprRef = useRef(1)
  const colorsRef = useRef({ head: "#6ee7f7", redis: "#ff7a90" })
  const reducedRef = useRef(false)
  const followRef = useRef(followMode)
  const httpCountRef = useRef(0)

  // xyflow's live viewport [x, y, zoom]. Kept in a ref so the draw loop reads
  // the latest without the loop depending on it (edge paths are flow-space).
  const transform = useStore((s) => s.transform)
  const transformRef = useRef(transform)

  const nodesInitialized = useNodesInitialized()

  // Resolve a hop (a→b) to an edge LUT: the forward edge, or the reverse edge
  // traversed backwards (TOPO_EDGES only defines forward directions).
  const resolveHop = (a: ObsNodeId, b: ObsNodeId): Segment | null => {
    const fwd = lutsRef.current.get(`e:${a}:${b}`)
    if (fwd) return { lut: fwd, reversed: false }
    const rev = lutsRef.current.get(`e:${b}:${a}`)
    if (rev) return { lut: rev, reversed: true }
    return null
  }

  const canSpawn = (n: number): boolean =>
    (cometsRef.current.length + n) * PARTICLES_PER_COMET <= MAX_PARTICLES

  const startLoop = () => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw)
  }

  const spawn = (segments: Segment[], color: string, origin: CometOrigin): void => {
    if (segments.length === 0) return
    // startMs is stamped on the first frame (from the rAF clock) so the whole
    // spawn keeps time in the same units the draw loop reads.
    cometsRef.current.push({ segments, startMs: -1, color, origin })
    startLoop()
  }

  // Trace chain browser→gateway→<service>. The service node comes from the
  // shared router (upstream-ip slot mapping for chat); a non-gateway route
  // (e.g. a raw chat.message) collapses to just browser→gateway.
  const spawnTrace = (env: StoredEnvelope, origin: CometOrigin): void => {
    if (reducedRef.current || !canSpawn(1)) return
    const route = routeForEvent(env, slotForUpstream)
    const hops: [ObsNodeId, ObsNodeId][] = [["browser", "gateway"]]
    if (route.nodes[0] === "gateway" && route.nodes[1]) {
      hops.push(["gateway", route.nodes[1] as ObsNodeId])
    }
    const segments = hops
      .map(([a, b]) => resolveHop(a, b))
      .filter((s): s is Segment => s !== null)
    spawn(segments, colorsRef.current.head, origin)
  }

  // The fanout moment: 3 simultaneous comets radiating redis→chat-1..3.
  const spawnFanout = (): void => {
    if (reducedRef.current || !canSpawn(3)) return
    for (const chat of ["chat-1", "chat-2", "chat-3"] as ObsNodeId[]) {
      const seg = resolveHop("redis", chat)
      if (seg) spawn([seg], colorsRef.current.redis, "fanout")
    }
  }

  // The one rAF frame. Clears, applies the flow transform, draws every live
  // comet's trail + head, culls finished ones, and stops itself when idle.
  const draw = (now: number): void => {
    rafRef.current = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const dpr = dprRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const [tx, ty, zoom] = transformRef.current
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty)
    ctx.lineCap = "round"

    const alive: Comet[] = []
    for (const comet of cometsRef.current) {
      if (comet.startMs < 0) comet.startMs = now
      const g = (now - comet.startMs) / (comet.segments.length * HOP_MS)
      if (g >= 1) continue // head has arrived — retire it
      alive.push(comet)

      ctx.fillStyle = comet.color
      // Trail: farther-behind samples are smaller and dimmer.
      ctx.shadowBlur = 0
      for (let k = TRAIL; k >= 1; k--) {
        const tg = g - k * TRAIL_STEP
        if (tg < 0) continue
        const p = posAt(comet, tg)
        ctx.globalAlpha = (1 - k / (TRAIL + 1)) * 0.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, HEAD_R * (1 - k / (TRAIL + 2)), 0, TAU)
        ctx.fill()
      }
      // Bright head with a canvas glow (shadow is fine here — not the DOM).
      const h = posAt(comet, g)
      ctx.globalAlpha = 1
      ctx.shadowColor = comet.color
      ctx.shadowBlur = HEAD_BLUR
      ctx.beginPath()
      ctx.arc(h.x, h.y, HEAD_R, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0

    cometsRef.current = alive
    if (alive.length > 0) rafRef.current = requestAnimationFrame(draw)
  }

  // Size the backing store to the pane in device pixels, on mount + resize.
  const resize = (): void => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const dpr = window.devicePixelRatio || 1
    dprRef.current = dpr
    const rect = parent.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
  }

  // Build one LUT per edge by sampling its rendered SVG path. Rebuilt whenever
  // nodes (re)initialize or the window resizes.
  const rebuildLuts = (): void => {
    resize()
    const next = new Map<string, Point[]>()
    for (const edge of TOPO_EDGES) {
      const path = document.querySelector(
        `.react-flow__edge[data-id="${edge.id}"] path.react-flow__edge-path`,
      )
      if (!(path instanceof SVGPathElement)) continue
      try {
        next.set(edge.id, buildLut(path))
      } catch {
        // getTotalLength/getPointAtLength unavailable — skip this edge.
      }
    }
    lutsRef.current = next
  }

  // Resolve the two comet colors ONCE off the .obs root, wire the
  // reduced-motion guard, and keep the canvas sized. No per-frame DOM reads.
  useEffect(() => {
    const root = canvasRef.current?.closest(".obs")
    if (root) {
      const cs = getComputedStyle(root)
      const head = cs.getPropertyValue("--accent-strong").trim()
      const redis = cs.getPropertyValue("--evt-redis").trim()
      colorsRef.current = { head: head || "#6ee7f7", redis: redis || "#ff7a90" }
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedRef.current = mq.matches
    const onMq = (e: MediaQueryListEvent) => (reducedRef.current = e.matches)
    mq.addEventListener("change", onMq)

    const onResize = () => rebuildLuts()
    window.addEventListener("resize", onResize)
    return () => {
      mq.removeEventListener("change", onMq)
      window.removeEventListener("resize", onResize)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once nodes are measured the edge paths exist — sample them.
  useEffect(() => {
    if (nodesInitialized) rebuildLuts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized])

  // The draw loop reads the viewport transform and the event router reads
  // followMode through refs, synced after commit — so neither the rAF loop nor
  // the store subscription re-binds or re-renders when they change.
  useEffect(() => {
    transformRef.current = transform
  }, [transform])
  useEffect(() => {
    followRef.current = followMode
  }, [followMode])

  // Per-batch event router — zero React. Reads followMode/selectedCorr through
  // refs/getState so the subscription itself never needs re-binding.
  useEffect(() => {
    return useObsStore.getState().onFresh((fresh) => {
      if (reducedRef.current) return
      const selectedCorr = useObsStore.getState().selectedCorr
      for (const env of fresh) {
        if (selectedCorr && env.corr === selectedCorr) spawnTrace(env, "trace")
        if (env.type === "chat.message" && (selectedCorr || followRef.current)) spawnFanout()
        if (followRef.current && env.type === "http.request") {
          httpCountRef.current += 1
          if (
            httpCountRef.current % FOLLOW_EVERY === 0 &&
            cometsRef.current.filter((c) => c.origin === "follow").length < MAX_FOLLOW_COMETS
          ) {
            spawnTrace(env, "follow")
          }
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clicking a ⌁corr chip sets selectedCorr — replay the matching buffered
  // events so a comet fires immediately, not only on the next live one.
  const selectedCorr = useObsStore((s) => s.selectedCorr)
  useEffect(() => {
    if (!selectedCorr || reducedRef.current) return
    for (const env of useObsStore.getState().events) {
      if (env.corr === selectedCorr) spawnTrace(env, "trace")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCorr])

  return (
    <canvas
      ref={canvasRef}
      className="obs-comet"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 10,
      }}
    />
  )
}
