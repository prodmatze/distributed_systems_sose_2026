// Shared contract between the observer feed and anything that drives it —
// the live WS source and the offline mock both implement this, so the hook
// (and every test) can swap one for the other without knowing which is which.
import type { WsFrame } from "./types"
import type { ConnState } from "./store"

export type StreamHandlers = {
  onFrame(f: WsFrame): void
  onStatus(s: ConnState): void
  onConnect(resumedFrom: string | null): void // called on every (re)connect, before frames
  resumeFrom(): string | null // hook supplies the last seen id
}

export type StreamSource = { start(h: StreamHandlers): () => void }
