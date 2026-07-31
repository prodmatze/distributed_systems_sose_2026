"use client"

// Only Overview exists. The Traces/Chat/Redis/Database/Containers tabs were
// designed but never built, and rendering them as permanently disabled buttons
// read as broken rather than as scope — so they are gone. Re-add an entry here
// when there is a real panel behind it.
const TABS = ["overview"] as const
export type TabId = (typeof TABS)[number]

export function TabBar({ active }: { active: TabId }) {
  return (
    <nav aria-label="dashboard sections" style={{ display: "flex", gap: "var(--space-1)" }}>
      {TABS.map((t) => {
        const current = t === active
        return (
          <span
            key={t}
            aria-current={current ? "page" : undefined}
            className="obs-micro"
            style={{
              padding: "var(--space-2) var(--space-4)",
              background: current ? "var(--accent-dim)" : "transparent",
              color: current ? "var(--accent)" : "var(--text-2)",
              border: "1px solid",
              borderColor: current ? "var(--accent-border)" : "transparent",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {t}
          </span>
        )
      })}
    </nav>
  )
}
