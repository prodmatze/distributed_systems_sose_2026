"use client"

const TABS = ["overview", "traces", "chat", "redis", "database", "containers"] as const
export type TabId = (typeof TABS)[number]
const ENABLED: ReadonlySet<TabId> = new Set(["overview"])

export function TabBar({ active }: { active: TabId }) {
  return (
    <nav aria-label="dashboard sections" style={{ display: "flex", gap: "var(--space-1)" }}>
      {TABS.map((t) => {
        const enabled = ENABLED.has(t)
        const current = t === active
        return (
          <button
            key={t}
            type="button"
            disabled={!enabled}
            aria-current={current ? "page" : undefined}
            className="obs-micro"
            style={{
              padding: "var(--space-2) var(--space-4)",
              background: current ? "var(--accent-dim)" : "transparent",
              color: current ? "var(--accent)" : enabled ? "var(--text-2)" : "var(--text-3)",
              border: "1px solid",
              borderColor: current ? "var(--accent-border)" : "transparent",
              borderRadius: "var(--radius-sm)",
              cursor: enabled ? "pointer" : "default",
            }}
          >
            {t}
          </button>
        )
      })}
    </nav>
  )
}
