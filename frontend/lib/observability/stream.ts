"use client"

// Mount once per dashboard. Owns the single stream connection and the 1 Hz
// derive tick; everything else reads the store.
import { useEffect } from "react"

import { observerWsUrl } from "./env"
import { createMockSource } from "./mock"
import { useObsStore } from "./store"
import { createWsSource } from "./ws-source"

export function useObservabilityStream(mock: boolean): void {
  useEffect(() => {
    const store = useObsStore.getState()
    store.setMode(mock)
    store.beginFresh()
    const source = mock ? createMockSource() : createWsSource(observerWsUrl())
    const stop = source.start({
      onFrame: (f) => {
        const s = useObsStore.getState()
        if (f.type === "snapshot") s.applySnapshot(f.state)
        else s.ingestBatch(f.events, f.elided)
      },
      onStatus: (c) => useObsStore.getState().setConn(c),
      onConnect: (resumedFrom) => {
        const s = useObsStore.getState()
        if (resumedFrom) s.markResumed(resumedFrom, Date.now())
        else s.beginFresh()
      },
      resumeFrom: () => useObsStore.getState().lastEventId,
    })
    const timer = setInterval(() => useObsStore.getState().tick(Date.now()), 1000)
    if (process.env.NODE_ENV !== "production") {
      ;(window as unknown as Record<string, unknown>).__obs = useObsStore
    }
    return () => {
      stop()
      clearInterval(timer)
    }
  }, [mock])
}
