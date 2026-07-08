"use client"

import type { DisplayRow } from "@/lib/observability/fold-display"

type FoldDisplayRow = Extract<DisplayRow, { kind: "fold" }>

// A collapsed run of hot same-second events (fold-display.ts). Deliberately
// plain and non-interactive — same row rhythm as EventRow but no corr chip,
// no expand affordance, --text-3 so it reads as "traffic happened here" and
// nothing more.
export function FoldRow({ row }: { row: FoldDisplayRow }) {
  return (
    <div
      style={{
        padding: "1px var(--space-4)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.7,
        color: "var(--text-3)",
        whiteSpace: "nowrap",
      }}
    >
      ▸ {row.count} events (collapsed)
    </div>
  )
}
