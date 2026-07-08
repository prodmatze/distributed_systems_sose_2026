// Reconnecting WS client for the observer feed. Same backoff idiom as
// lib/ws.ts (chat). Resume only after short gaps: a single resume read
// covers <=500 missed events server-side, so after 30s we reconnect fresh
// and take a new snapshot instead of chasing a hole in the stream.
import type { StreamHandlers, StreamSource } from "./source"
import { parseFrame } from "./types"

const RESUME_WINDOW_MS = 30_000

export function createWsSource(baseUrl: string): StreamSource {
  return {
    start(h: StreamHandlers) {
      let ws: WebSocket | null = null
      let stopped = false
      let attempts = 0
      let closedAt: number | null = null
      let timer: ReturnType<typeof setTimeout> | null = null

      const connect = () => {
        if (stopped) return
        // closedAt marks the START of the current outage (set on the first
        // close, cleared on a successful open) — measuring from the latest
        // close would never exceed the window, since backoff caps at 10s.
        const recent = closedAt !== null && Date.now() - closedAt < RESUME_WINDOW_MS
        const resume = recent ? h.resumeFrom() : null
        const url = resume ? `${baseUrl}?resume_from=${encodeURIComponent(resume)}` : baseUrl
        h.onStatus(attempts === 0 ? "connecting" : "reconnecting")
        ws = new WebSocket(url)
        ws.onopen = () => {
          attempts = 0
          closedAt = null
          h.onConnect(resume)
          h.onStatus("live")
        }
        ws.onmessage = (ev) => {
          const frame = parseFrame(ev.data)
          if (frame) h.onFrame(frame)
        }
        ws.onclose = () => {
          if (stopped) {
            h.onStatus("closed")
            return
          }
          if (closedAt === null) closedAt = Date.now()
          attempts += 1
          h.onStatus("reconnecting")
          timer = setTimeout(connect, Math.min(500 * 2 ** (attempts - 1), 10_000))
        }
        ws.onerror = () => ws?.close()
      }

      connect()
      return () => {
        stopped = true
        if (timer) clearTimeout(timer)
        ws?.close()
        h.onStatus("closed")
      }
    },
  }
}
