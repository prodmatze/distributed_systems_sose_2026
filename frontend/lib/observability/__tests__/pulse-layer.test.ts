import { beforeEach, describe, expect, test, vi } from "vitest"

import { firePulse, registerNodeEl } from "@/components/observability/pulse-layer"

function makeNodeEl(): HTMLElement {
  const el = document.createElement("div")
  const pulse = document.createElement("span")
  pulse.className = "obs-pulse"
  el.appendChild(pulse)
  ;(pulse as unknown as { animate: unknown }).animate = vi.fn()
  return el
}

describe("firePulse", () => {
  beforeEach(() => registerNodeEl("gateway", null))

  test("animates the pulse span of a registered node", () => {
    const el = makeNodeEl()
    registerNodeEl("gateway", el)
    expect(firePulse("gateway", "red", 1000)).toBe(true)
    expect((el.querySelector(".obs-pulse") as unknown as { animate: ReturnType<typeof vi.fn> }).animate).toHaveBeenCalledOnce()
  })

  test("returns false for unregistered nodes", () => {
    expect(firePulse("nope", "red", 1000)).toBe(false)
  })

  test("caps at 8 pulses per node per second, resets next second", () => {
    const el = makeNodeEl()
    registerNodeEl("gateway", el)
    for (let i = 0; i < 8; i++) expect(firePulse("gateway", "red", 5000 + i)).toBe(true)
    expect(firePulse("gateway", "red", 5900)).toBe(false)
    expect(firePulse("gateway", "red", 6001)).toBe(true)
  })
})
