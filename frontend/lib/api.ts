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
