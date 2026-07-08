import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { EventRow } from "@/components/observability/event-row"
import { useObsStore } from "@/lib/observability/store"
import type { StoredEnvelope } from "@/lib/observability/types"

function httpEnv(corr: string | null): StoredEnvelope {
  return {
    id: "1720374000123-0",
    type: "http.request",
    service: "api",
    ts: "2026-07-08T18:42:08.501Z",
    tsMs: Date.parse("2026-07-08T18:42:08.501Z"),
    corr,
    payload: { method: "GET", uri: "/api/channels", status: 200, rt_ms: 12.4, upstream: "172.19.0.11", remote: "10.0.0.1" },
  }
}

describe("EventRow", () => {
  test("renders method/status text and the corr chip", () => {
    render(<EventRow env={httpEnv("c3f1a9e2ffff0000")} />)
    expect(screen.getByText("GET /api/channels → 200 12.4ms")).toBeInTheDocument()
    expect(screen.getByText("⌁c3f1a9e2")).toBeInTheDocument()
  })

  test("omits the corr chip when the envelope has no correlation id", () => {
    render(<EventRow env={httpEnv(null)} />)
    expect(screen.queryByText(/^⌁/)).not.toBeInTheDocument()
  })

  test("clicking the corr chip selects that correlation id in the store", () => {
    useObsStore.setState({ selectedCorr: null })
    render(<EventRow env={httpEnv("c3f1a9e2ffff0000")} />)
    fireEvent.click(screen.getByText("⌁c3f1a9e2"))
    expect(useObsStore.getState().selectedCorr).toBe("c3f1a9e2ffff0000")
  })
})
