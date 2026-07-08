export function Sparkline({ data, color = "var(--accent)", width = 96, height = 24 }: {
  data: number[]; color?: string; width?: number; height?: number
}) {
  const max = Math.max(1, ...data)
  const step = width / Math.max(1, data.length - 1)
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
    .join(" ")
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block", opacity: 0.9 }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
