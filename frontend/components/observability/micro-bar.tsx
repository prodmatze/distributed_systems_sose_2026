// A single dense metric bar for the node card: uppercase micro-label, a thin
// track with a colored fill, and the tabular value. The fill width is set from
// props and eased via a CSS width transition — never a per-frame animation.
export function MicroBar({
  label,
  value,
  max = 100,
  unit = "",
  color,
}: {
  label: string
  value: number | null
  max?: number
  unit?: string
  color: string
}) {
  const pct = value === null ? 0 : Math.min(Math.max(value / max, 0), 1) * 100
  return (
    <div className="obs-microbar">
      <span className="obs-microbar-label">{label}</span>
      <span className="obs-microbar-track" aria-hidden="true">
        <span className="obs-microbar-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="obs-microbar-val obs-num">{value === null ? "—" : `${Math.round(value)}${unit}`}</span>
    </div>
  )
}
