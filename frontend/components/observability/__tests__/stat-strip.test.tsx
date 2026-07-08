import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { Sparkline } from "@/components/observability/sparkline"
import { StatStrip } from "@/components/observability/stat-strip"
import { useObsStore } from "@/lib/observability/store"

describe("stat strip", () => {
  test("renders derived values", () => {
    useObsStore.setState({
      derived: {
        ...useObsStore.getState().derived,
        reqRate: 6.2, msgRate: 4, evtRate: 12.4,
        onlineUsers: 5, containersUp: 10, containersTotal: 11, replicas: 3,
      },
    })
    render(<StatStrip />)
    expect(screen.getByText("6.2")).toBeInTheDocument()
    expect(screen.getByText("10/11")).toBeInTheDocument()
    expect(screen.getByText("×3")).toBeInTheDocument()
  })

  test("shows flow mode chip when degraded", () => {
    useObsStore.setState({ derived: { ...useObsStore.getState().derived, degraded: true } })
    render(<StatStrip />)
    expect(screen.getByText("FLOW MODE")).toBeInTheDocument()
  })
})

test("sparkline draws one point per bucket", () => {
  const { container } = render(<Sparkline data={[0, 2, 4, 2]} />)
  const points = container.querySelector("polyline")?.getAttribute("points")?.trim().split(" ")
  expect(points).toHaveLength(4)
})
