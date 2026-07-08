import { describe, expect, test } from "vitest"

import { buildLut, sampleLut } from "@/components/observability/comet-canvas"

type Pt = { x: number; y: number }

// Whether the running environment has a usable SVG geometry API. jsdom defines
// neither SVGPathElement nor getTotalLength/getPointAtLength, so buildLut can
// only be exercised in a real browser — the rest is pure math.
function hasPathApi(): boolean {
  if (typeof document === "undefined") return false
  try {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path") as SVGPathElement
    p.setAttribute("d", "M0 0 L10 0")
    if (typeof p.getTotalLength !== "function") return false
    p.getTotalLength()
    return true
  } catch {
    return false
  }
}

describe("sampleLut", () => {
  // A 3-point LUT spanning t∈[0,1]: t=0→p0, t=0.5→p1, t=1→p2.
  const lut: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 10 },
  ]

  test("t=0 returns the first point", () => {
    expect(sampleLut(lut, 0)).toEqual({ x: 0, y: 0 })
  })

  test("t=1 returns the last point", () => {
    expect(sampleLut(lut, 1)).toEqual({ x: 20, y: 10 })
  })

  test("t<0 clamps to the first point", () => {
    expect(sampleLut(lut, -0.5)).toEqual({ x: 0, y: 0 })
    expect(sampleLut(lut, -100)).toEqual({ x: 0, y: 0 })
  })

  test("t>1 clamps to the last point", () => {
    expect(sampleLut(lut, 1.5)).toEqual({ x: 20, y: 10 })
    expect(sampleLut(lut, 100)).toEqual({ x: 20, y: 10 })
  })

  test("interpolates linearly inside the first segment", () => {
    // t=0.25 → position 0.5 of the way from p0 to p1 → (5, 0)
    expect(sampleLut(lut, 0.25)).toEqual({ x: 5, y: 0 })
  })

  test("interpolates linearly inside the second segment", () => {
    // t=0.75 → position 0.5 of the way from p1 to p2 → (15, 5)
    expect(sampleLut(lut, 0.75)).toEqual({ x: 15, y: 5 })
  })

  test("midpoint of a two-point LUT is the geometric midpoint", () => {
    const line: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
    ]
    expect(sampleLut(line, 0.5)).toEqual({ x: 50, y: 20 })
  })

  test("a single-point LUT returns that point for any t", () => {
    const one: Pt[] = [{ x: 7, y: 3 }]
    expect(sampleLut(one, 0)).toEqual({ x: 7, y: 3 })
    expect(sampleLut(one, 0.5)).toEqual({ x: 7, y: 3 })
    expect(sampleLut(one, 1)).toEqual({ x: 7, y: 3 })
  })
})

describe("buildLut", () => {
  test.skipIf(!hasPathApi())("samples the requested number of points along a path", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path") as SVGPathElement
    path.setAttribute("d", "M0 0 L100 0")
    svg.appendChild(path)
    document.body.appendChild(svg)

    const lut = buildLut(path, 16)
    expect(lut).toHaveLength(16)
    expect(lut[0]).toEqual({ x: 0, y: 0 })
    expect(lut[lut.length - 1].x).toBeCloseTo(100, 3)

    document.body.removeChild(svg)
  })
})
