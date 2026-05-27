"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { clearSession, getCurrentUser, type User } from "@/lib/api"

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setUser(getCurrentUser())
    setReady(true)
  }, [])

  function handleLogout() {
    clearSession()
    setUser(null)
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Chorus</CardTitle>
          <CardDescription>
            Discord-style chat — distributed systems coursework.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!ready ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : user ? (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Signed in as</p>
              <p className="text-lg font-medium">{user.username}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not signed in.</p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {ready && user && (
            <Button className="w-full" variant="outline" onClick={handleLogout}>
              Sign out
            </Button>
          )}
          {ready && !user && (
            <>
              <Button className="w-full" onClick={() => router.push("/login")}>
                Sign in
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => router.push("/register")}
              >
                Create account
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </main>
  )
}
