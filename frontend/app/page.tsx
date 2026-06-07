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
import { getToken } from "@/lib/api"

export default function Home() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (getToken()) {
      router.replace("/chat")
      return
    }
    setReady(true)
  }, [router])

  if (!ready) return null

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
          <p className="text-sm text-muted-foreground">
            Sign in to start chatting.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
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
        </CardFooter>
      </Card>
    </main>
  )
}
