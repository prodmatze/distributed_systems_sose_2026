"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Hash, LogOut, Plus, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  clearSession,
  createChannel,
  getChannels,
  getMe,
  getMessages,
  getToken,
  joinChannel,
  type Channel,
  type Message,
  type User,
} from "@/lib/api"
import { useChatSocket, type ConnStatus } from "@/lib/ws"

function mergeById(a: Message[], b: Message[]): Message[] {
  const map = new Map<number, Message>()
  for (const m of a) map.set(m.id, m)
  for (const m of b) map.set(m.id, m)
  return [...map.values()].sort((x, y) => x.id - y.id)
}

const STATUS: Record<ConnStatus, { text: string; color: string }> = {
  connecting: { text: "Connecting…", color: "bg-yellow-500" },
  connected: { text: "Connected", color: "bg-green-500" },
  disconnected: { text: "Disconnected", color: "bg-red-500" },
}

function rowClass(active: boolean, joined: boolean): string {
  const base =
    "flex items-center gap-2 flex-1 rounded-md px-2 py-1.5 text-sm transition-colors"
  if (active) return `${base} bg-accent text-accent-foreground`
  if (joined) return `${base} hover:bg-accent/50`
  return `${base} opacity-60 cursor-default`
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

export default function ChatPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [myChannelIds, setMyChannelIds] = useState<Set<number>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Record<number, Message[]>>({})
  const loadedHistory = useRef<Set<number>>(new Set())
  const [draft, setDraft] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Auth guard: confirm a token exists AND that it still works (validate it
  // against the server via /me). A stale token bounces to /login instead of
  // letting the user into a broken /chat.
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login")
      return
    }
    getMe()
      .then((me) => {
        setUser(me)
        setReady(true)
      })
      .catch(() => {
        clearSession()
        router.replace("/login")
      })
  }, [router])

  const refreshChannels = useCallback(async () => {
    try {
      setChannels(await getChannels())
    } catch {
      // authed() clears the session on 401; the guard will redirect
    }
  }, [])

  useEffect(() => {
    if (ready) refreshChannels()
  }, [ready, refreshChannels])

  // WebSocket: ready frame = my memberships; message frame = append
  const onReady = useCallback((ids: number[]) => {
    setMyChannelIds(new Set(ids))
    setSelectedId((cur) => cur ?? (ids.length ? ids[0] : null))
  }, [])

  const onMessage = useCallback((msg: Message) => {
    setMessages((prev) => ({
      ...prev,
      [msg.channel_id]: mergeById(prev[msg.channel_id] ?? [], [msg]),
    }))
  }, [])

  const { status, send, reconnect } = useChatSocket({ onReady, onMessage })

  // Load history once when a joined channel is opened
  useEffect(() => {
    if (selectedId == null || !myChannelIds.has(selectedId)) return
    if (loadedHistory.current.has(selectedId)) return
    const id = selectedId
    loadedHistory.current.add(id)
    getMessages(id, { limit: 50 })
      .then((hist) =>
        setMessages((prev) => ({
          ...prev,
          [id]: mergeById(prev[id] ?? [], hist),
        })),
      )
      .catch(() => loadedHistory.current.delete(id))
  }, [selectedId, myChannelIds])

  const current = selectedId != null ? messages[selectedId] ?? [] : []

  // Auto-scroll to the latest message
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [current.length, selectedId])

  function handleSend() {
    const body = draft.trim()
    if (!body || selectedId == null) return
    send(selectedId, body)
    setDraft("")
  }

  async function handleJoin(id: number) {
    try {
      await joinChannel(id)
      setMyChannelIds((prev) => new Set(prev).add(id))
      setSelectedId(id)
      await refreshChannels()
      reconnect() // re-read membership so this channel's live messages arrive
    } catch {
      // ignore; the channel stays joinable
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    try {
      const ch = await createChannel({
        name,
        description: newDesc.trim() || undefined,
      })
      setCreateOpen(false)
      setNewName("")
      setNewDesc("")
      setMyChannelIds((prev) => new Set(prev).add(ch.id))
      await refreshChannels()
      setSelectedId(ch.id)
      reconnect()
    } catch {
      // a duplicate name (409) just leaves the dialog open
    }
  }

  function handleSignOut() {
    clearSession()
    router.replace("/login")
  }

  if (!ready) return null

  const selected = channels.find((c) => c.id === selectedId) ?? null
  const s = STATUS[status]

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r bg-muted/30">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <span className="font-semibold">Chorus</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Create channel"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create channel</DialogTitle>
                <DialogDescription>
                  Public channel that anyone can join.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ch-name">Name</Label>
                  <Input
                    id="ch-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="general"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-desc">Description (optional)</Label>
                  <Input
                    id="ch-desc"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="What's this channel about?"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={!newName.trim()}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <nav className="space-y-0.5">
            {channels.map((c) => {
              const joined = myChannelIds.has(c.id)
              const active = c.id === selectedId
              return (
                <div key={c.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => joined && setSelectedId(c.id)}
                    disabled={!joined}
                    className={rowClass(active, joined)}
                  >
                    <Hash className="size-4 shrink-0 opacity-60" />
                    <span className="flex-1 truncate text-left">{c.name}</span>
                    <span className="text-xs opacity-50">{c.member_count}</span>
                  </button>
                  {!joined && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleJoin(c.id)}
                    >
                      Join
                    </Button>
                  )}
                </div>
              )
            })}
            {channels.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No channels yet. Create one with +
              </p>
            )}
          </nav>
        </div>

        <Separator />
        <div className="flex items-center gap-2 p-3">
          <Avatar className="size-8">
            <AvatarFallback>
              {(user?.username ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.username}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className={`inline-block size-2 rounded-full ${s.color}`} />
              {s.text}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>

      {/* Main pane */}
      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex h-14 items-center gap-2 border-b px-4">
              <Hash className="size-5 opacity-60" />
              <span className="font-semibold">{selected.name}</span>
              {selected.description && (
                <span className="truncate text-sm text-muted-foreground">
                  — {selected.description}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {selected.member_count} members
              </span>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
              {current.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No messages yet. Say hi 👋
                </p>
              )}
              {current.map((m) => (
                <div key={m.id} className="flex gap-3">
                  <Avatar className="mt-0.5 size-9">
                    <AvatarFallback>
                      {m.sender_username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">
                        {m.sender_username}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(m.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {m.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t p-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Message #${selected.name}`}
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim()}
                  aria-label="Send"
                >
                  <Send className="size-4" />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Hash className="mx-auto mb-2 size-10 opacity-30" />
              <p>Select a channel to start chatting</p>
              <p className="text-sm">or join one from the sidebar</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
