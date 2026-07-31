import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { ConnectionPill } from "@/components/observability/connection-pill"
import { TabBar } from "@/components/observability/tab-bar"
import { useObsStore } from "@/lib/observability/store"

describe("shell", () => {
  test("tab bar marks overview current and advertises no unbuilt tabs", () => {
    render(<TabBar active="overview" />)
    expect(screen.getByText("overview")).toHaveAttribute("aria-current", "page")
    // The five designed-but-never-built tabs must not appear at all — a
    // disabled button that does nothing reads as a bug, not as scope.
    for (const gone of ["traces", "chat", "redis", "database", "containers"]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
  })

  test("connection pill reflects store state", () => {
    useObsStore.getState().setConn("live")
    useObsStore.getState().setMode(true)
    render(<ConnectionPill />)
    expect(screen.getByText("LIVE")).toBeInTheDocument()
    // Regex, not exact: the pill renders a "▶" glyph in the same text node.
    expect(screen.getByText(/SIMULATION/)).toBeInTheDocument()
  })
})
