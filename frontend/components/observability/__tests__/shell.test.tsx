import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { ConnectionPill } from "@/components/observability/connection-pill"
import { TabBar } from "@/components/observability/tab-bar"
import { useObsStore } from "@/lib/observability/store"

describe("shell", () => {
  test("tab bar marks overview current, others disabled", () => {
    render(<TabBar active="overview" />)
    expect(screen.getByRole("button", { name: "overview" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "traces" })).toBeDisabled()
  })

  test("connection pill reflects store state", () => {
    useObsStore.getState().setConn("live")
    useObsStore.getState().setMode(true)
    render(<ConnectionPill />)
    expect(screen.getByText("LIVE")).toBeInTheDocument()
    expect(screen.getByText("MOCK FEED")).toBeInTheDocument()
  })
})
