const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"

export type User = {
  id: number
  username: string
  email: string
  created_at: string
}

export type TokenResponse = {
  access_token: string
  token_type: string
  user: User
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (typeof body.detail === "string") detail = body.detail
    } catch {
      // body wasn't JSON; fall back to statusText
    }
    throw new ApiError(res.status, detail)
  }

  return res.json() as Promise<T>
}

export async function register(payload: {
  email: string
  username: string
  password: string
}): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function login(payload: {
  username: string
  password: string
}): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

const TOKEN_KEY = "chorus.access_token"
const USER_KEY = "chorus.user"

export function saveSession(t: TokenResponse) {
  if (typeof window === "undefined") return
  localStorage.setItem(TOKEN_KEY, t.access_token)
  localStorage.setItem(USER_KEY, JSON.stringify(t.user))
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

export function getCurrentUser(): User | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function clearSession() {
  if (typeof window === "undefined") return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// --- Channels & messages -------------------------------------------------

export type Channel = {
  id: number
  name: string
  description: string | null
  member_count: number
  created_at: string
}

export type Message = {
  id: number
  channel_id: number
  sender_id: number
  sender_username: string
  body: string
  created_at: string
}

// Like `request`, but attaches the bearer token. A 401 means the session is
// dead, so clear it — the UI guard will then bounce to /login.
async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  try {
    return await request<T>(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) clearSession()
    throw err
  }
}

export async function getMe(): Promise<User> {
  return authed<User>("/api/users/me")
}

export async function getChannels(): Promise<Channel[]> {
  return authed<Channel[]>("/api/channels")
}

export async function createChannel(payload: {
  name: string
  description?: string
}): Promise<Channel> {
  return authed<Channel>("/api/channels", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function joinChannel(channelId: number): Promise<Channel> {
  return authed<Channel>(`/api/channels/${channelId}/join`, { method: "POST" })
}

export async function getMessages(
  channelId: number,
  opts?: { before?: number; limit?: number },
): Promise<Message[]> {
  const q = new URLSearchParams()
  if (opts?.before) q.set("before", String(opts.before))
  if (opts?.limit) q.set("limit", String(opts.limit))
  const qs = q.toString()
  return authed<Message[]>(
    `/api/channels/${channelId}/messages${qs ? `?${qs}` : ""}`,
  )
}

// WebSocket URL for the chat gateway, derived from the REST origin.
// The `uid` param lets the gateway pin this socket to a fixed chat replica
// (session affinity via `hash $arg_uid` in nginx). It is a routing hint only and
// is never trusted for authorization — the chat service authenticates via `token`.
export function wsUrl(token: string, lastSeenId = 0): string {
  const base = API_URL.replace(/^http/, "ws")
  const uid = getCurrentUser()?.id ?? ""
  return `${base}/ws?token=${encodeURIComponent(token)}&last_seen_id=${lastSeenId}&uid=${uid}`
}
