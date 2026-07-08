// Per-event WAAPI pulses on the topology's .obs-pulse spans. Zero React: a
// module-level DOM registry keyed by node id, animated directly on the
// element via Element.animate. This is the seam Task 9's routeForEvent feeds
// and topology-node.tsx's ref populates — the store's onFresh listener
// registry drives it per batch, never a re-render. Continuous CPU glow
// (topology-node.tsx) carries the "busy" signal once the per-node rate cap
// kicks in; pulses stay a discrete "something happened" flourish.
import { useObsStore } from "@/lib/observability/store"
import { makeSlotAllocator, routeForEvent } from "@/lib/observability/topology-model"

const PULSE_CAP_PER_S = 8

const nodeEls = new Map<string, HTMLElement>()
const tokenSecond = new Map<string, number>()
const tokenCount = new Map<string, number>()

export function registerNodeEl(id: string, el: HTMLElement | null): void {
  if (el) nodeEls.set(id, el)
  else nodeEls.delete(id)
}

function animateSpan(span: HTMLElement, color: string): void {
  span.style.borderColor = color
  if (typeof span.animate === "function") {
    span.animate(
      [
        { transform: "scale(0.85)", opacity: 0.9 },
        { transform: "scale(1.25)", opacity: 0 },
      ],
      { duration: 550, easing: "cubic-bezier(0.2,0.8,0.2,1)" },
    )
  }
}

export function firePulse(id: string, color: string, nowMs: number = Date.now()): boolean {
  const root = nodeEls.get(id)
  if (!root) return false
  const span = root.querySelector(".obs-pulse")
  if (!(span instanceof HTMLElement)) return false

  const second = Math.floor(nowMs / 1000)
  if (tokenSecond.get(id) !== second) {
    tokenSecond.set(id, second)
    tokenCount.set(id, 0)
  }
  const count = tokenCount.get(id) ?? 0
  if (count >= PULSE_CAP_PER_S) return false
  tokenCount.set(id, count + 1)

  animateSpan(span, color)
  return true
}

// docker.event pulses bypass the rate cap entirely — rare and demo-critical
// (the kill cycle must always flash red, even mid-firehose) — and don't
// consume a token, so they never starve other events' budget either.
function fireBypassingCap(id: string, color: string): void {
  const root = nodeEls.get(id)
  if (!root) return
  const span = root.querySelector(".obs-pulse")
  if (!(span instanceof HTMLElement)) return
  animateSpan(span, color)
}

export function attachPulseRouter(): () => void {
  const slotForUpstream = makeSlotAllocator()
  return useObsStore.getState().onFresh((fresh) => {
    const degraded = useObsStore.getState().derived.degraded
    for (const env of fresh) {
      if (degraded && env.type !== "docker.event") continue
      const { nodes, color } = routeForEvent(env, slotForUpstream)
      for (const id of nodes) {
        if (env.type === "docker.event") fireBypassingCap(id, color)
        else firePulse(id, color)
      }
    }
  })
}
