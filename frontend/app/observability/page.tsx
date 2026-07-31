"use client"

import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { Info } from "lucide-react"
import { useState } from "react"

import { AboutPanel } from "@/components/observability/about-panel"
import { ConnectionPill } from "@/components/observability/connection-pill"
import { Firehose } from "@/components/observability/firehose"
import { SimControls } from "@/components/observability/sim-controls"
import { StatStrip } from "@/components/observability/stat-strip"
import { TabBar } from "@/components/observability/tab-bar"
import { useObservabilityStream } from "@/lib/observability/stream"

// Lazy, client-only — keeps xyflow (and the whole topology tree) out of the
// chat app's bundle.
const Topology = dynamic(() => import("@/components/observability/topology").then((m) => m.Topology), {
  ssr: false,
})

export default function ObservabilityPage() {
  // ?mock=1 still works (tests and bookmarks rely on it) but it is now only the
  // starting value — the button owns the mode from then on, so nobody has to
  // know a URL flag to make the dashboard move.
  const initialMock = useSearchParams().get("mock") === "1"
  const [simulating, setSimulating] = useState(initialMock)
  const [aboutOpen, setAboutOpen] = useState(false)
  useObservabilityStream(simulating)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4)", height: "100dvh" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", height: "var(--header-h)", flexShrink: 0 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", letterSpacing: "var(--tracking-display)", margin: 0 }}>
          CHORUS <span style={{ color: "var(--accent)" }}>MISSION CONTROL</span>
        </h1>
        <TabBar active="overview" />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <SimControls running={simulating} onToggle={() => setSimulating((v) => !v)} />
          <button
            type="button"
            className="obs-chip obs-sim-btn"
            onClick={() => setAboutOpen(true)}
            title="What am I looking at?"
          >
            <Info size={11} aria-hidden />
            ABOUT
          </button>
          <ConnectionPill />
        </div>
      </header>
      <section id="obs-statstrip" aria-label="key rates" style={{ flexShrink: 0 }}>
        <StatStrip />
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(360px, 1fr)", gap: "var(--space-3)", flex: 1, minHeight: 0 }}>
        <section id="obs-topology" aria-label="system topology" className="obs-panel">
          <Topology />
        </section>
        <section id="obs-firehose" aria-label="event feed" className="obs-panel">
          <Firehose />
        </section>
      </div>
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
