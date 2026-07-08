import { Sparkline } from "./sparkline"

export function StatTile({ label, value, unit, spark, sparkColor, accent, alert, children }: {
  label: string; value: string; unit?: string; spark?: number[]; sparkColor?: string
  accent?: boolean; alert?: boolean; children?: React.ReactNode
}) {
  return (
    <div className="obs-panel" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-3) var(--space-4)", flex: 1, minWidth: 150 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="obs-micro">{label}</span>
        <span
          className="obs-num"
          style={{
            fontSize: accent ? "var(--text-3xl)" : "var(--text-2xl)",
            fontFamily: accent ? "var(--font-display)" : undefined,
            lineHeight: "var(--leading-tight)",
            color: alert ? "var(--status-crit)" : accent ? "var(--accent)" : "var(--text-1)",
          }}
        >
          {value}
          {unit && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", marginLeft: 4 }}>{unit}</span>}
        </span>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {children}
        {spark && <Sparkline data={spark} color={sparkColor} />}
      </div>
    </div>
  )
}
