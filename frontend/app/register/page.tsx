"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { ApiError, register, saveSession } from "@/lib/api"

const registerSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(12, "Username must be at most 12 characters"),
  password: z
    .string()
    .min(5, "Password must be at least 5 characters")
    .max(12, "Password must be at most 12 characters"),
})

type RegisterValues = z.infer<typeof registerSchema>

export default function RegisterPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<RegisterValues>({
    resolver: standardSchemaResolver(registerSchema),
    defaultValues: { email: "", username: "", password: "" },
  })

  async function onSubmit(values: RegisterValues) {
    setServerError(null)
    try {
      const tokenResponse = await register(values)
      saveSession(tokenResponse)
      router.push("/")
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Try again."
      setServerError(message)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your Chorus account</CardTitle>
          <CardDescription>
            Pick a username and password to get started.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="lam"
                        autoComplete="username"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {serverError && (
                <p className="text-sm font-medium text-destructive">
                  {serverError}
                </p>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Creating account…" : "Create account"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <a href="/login" className="underline underline-offset-4">
                  Sign in
                </a>
              </p>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </main>
  )
}
