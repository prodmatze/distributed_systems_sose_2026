import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Run test files one at a time. With parallel workers, jsdom forks
    // intermittently failed to tear down ("Worker exited unexpectedly", roughly
    // 1 run in 4) and vitest then printed a GREEN summary covering only the
    // files that survived — 10 or 11 of 13, no failure, no warning. A run that
    // silently skips a quarter of the suite is worse than a red one, and CI
    // would inherit the same lie.
    //
    // Isolation stays ON: the zustand store is module-level state, so sharing
    // one process across files would leak it between them.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
