"use client"

// Start/stop for the recorded demo feed. Replaces the old ?mock=1 URL flag so
// the dashboard can be driven from the page itself — open it, press one button,
// watch the system move. The flag still works as an initial value.
//
// This swaps the WHOLE data source: while it runs the live observer socket is
// closed and every number on screen comes from lib/observability/mock.ts. The
// SIMULATION pill in the connection area says so the entire time.
import { Play, Square } from "lucide-react"

export function SimControls({ running, onToggle }: { running: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="obs-chip obs-sim-btn"
      onClick={onToggle}
      aria-pressed={running}
      title={
        running
          ? "Stop the recorded demo feed and reconnect to the live observer"
          : "Replay a recorded event stream — useful when the stack is idle or offline"
      }
      data-running={running ? "1" : undefined}
    >
      {running ? <Square size={11} aria-hidden /> : <Play size={11} aria-hidden />}
      {running ? "STOP SIMULATION" : "START SIMULATION"}
    </button>
  )
}
