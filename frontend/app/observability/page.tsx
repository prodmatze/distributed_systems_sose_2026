"use client"

import { useSearchParams } from "next/navigation"

import { ConnectionPill } from "@/components/observability/connection-pill"
import { Firehose } from "@/components/observability/firehose"
import { StatStrip } from "@/components/observability/stat-strip"
import { TabBar } from "@/components/observability/tab-bar"
import { useObservabilityStream } from "@/lib/observability/stream"

export default function ObservabilityPage() {
  const mock = useSearchParams().get("mock") === "1"
  useObservabilityStream(mock)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4)", height: "100dvh" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", height: "var(--header-h)", flexShrink: 0 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", letterSpacing: "var(--tracking-display)", margin: 0 }}>
          CHORUS <span style={{ color: "var(--accent)" }}>MISSION CONTROL</span>
        </h1>
        <TabBar active="overview" />
        <div style={{ marginLeft: "auto" }}>
          <ConnectionPill />
        </div>
      </header>
      <section id="obs-statstrip" aria-label="key rates" style={{ flexShrink: 0 }}>
        <StatStrip />
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(360px, 1fr)", gap: "var(--space-3)", flex: 1, minHeight: 0 }}>
        <section id="obs-topology" aria-label="system topology" className="obs-panel" />
        <section id="obs-firehose" aria-label="event feed" className="obs-panel">
          <Firehose />
        </section>
      </div>
    </div>
  )
}
