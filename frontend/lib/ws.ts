"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getToken, wsUrl, type Message } from "@/lib/api"

export type ConnStatus = "connecting" | "connected" | "disconnected"

type Handlers = {
  onReady?: (channelIds: number[]) => void
  onMessage?: (msg: Message) => void
}

/**
 * Thin WebSocket client for the chat protocol. Owns connect/auth, tracks
 * `last_seen_id`, reconnects with exponential backoff, and dispatches typed
 * events. Kept out of components so the reconnect logic stays self-contained.
 */
export function useChatSocket(handlers: Handlers) {
  const [status, setStatus] = useState<ConnStatus>("disconnected")
  const wsRef = useRef<WebSocket | null>(null)
  const lastSeenRef = useRef(0)
  const attemptsRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const connect = useCallback(() => {
    const token = getToken()
    if (!token) return
    setStatus("connecting")
    const ws = new WebSocket(wsUrl(token, lastSeenRef.current))
    wsRef.current = ws

    ws.onopen = () => {
      attemptsRef.current = 0
      setStatus("connected")
    }

    ws.onmessage = (ev) => {
      let data: { type?: string; channels?: number[] } & Partial<Message>
      try {
        data = JSON.parse(ev.data)
      } catch {
        return
      }
      if (data.type === "ready") {
        handlersRef.current.onReady?.(data.channels ?? [])
      } else if (data.type === "message" && typeof data.id === "number") {
        if (data.id > lastSeenRef.current) lastSeenRef.current = data.id
        handlersRef.current.onMessage?.(data as Message)
      }
    }

    ws.onclose = () => {
      setStatus("disconnected")
      if (stoppedRef.current) return
      attemptsRef.current += 1
      const delay = Math.min(500 * 2 ** (attemptsRef.current - 1), 10000)
      timerRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    stoppedRef.current = false
    connect()
    return () => {
      stoppedRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((channelId: number, body: string) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "message", channel_id: channelId, body }))
    }
  }, [])

  // Force a fresh connection. Needed after joining a channel: the server reads
  // membership once at connect, so a reconnect is required to receive the new
  // channel's live messages.
  const reconnect = useCallback(() => {
    attemptsRef.current = 0
    if (timerRef.current) clearTimeout(timerRef.current)
    const ws = wsRef.current
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close() // onclose schedules a quick reconnect
    } else {
      connect()
    }
  }, [connect])

  return { status, send, reconnect }
}
