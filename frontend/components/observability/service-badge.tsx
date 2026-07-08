// Per-service chip. Hue comes from the fixed --svc-<service> token set in
// obs.css; anything not in that set falls back to --text-3 via the CSS
// var() fallback rather than branching in JS.
export function ServiceBadge({ service }: { service: string }) {
  return (
    <span
      className="obs-chip"
      style={{
        color: `var(--svc-${service}, var(--text-3))`,
        borderColor: "transparent",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {service || "?"}
    </span>
  )
}
