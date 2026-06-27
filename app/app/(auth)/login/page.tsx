"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function LoginPage() {
  const [guestLoading, setGuestLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Oikos Ledger
        </CardTitle>
        <CardDescription>Your household financial intelligence</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          className="w-full"
          disabled={googleLoading}
          onClick={async () => {
            setGoogleLoading(true)
            await signIn("google", { callbackUrl: "/" })
          }}
        >
          {googleLoading ? "Redirecting..." : "Continue with Google"}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full"
          disabled={guestLoading}
          onClick={async () => {
            setGuestLoading(true)
            await signIn("guest", { callbackUrl: "/" })
          }}
        >
          {guestLoading ? "Loading demo..." : "Try as Guest"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Guest mode uses pre-loaded demo data. No account required.
        </p>
      </CardContent>
    </Card>
  )
}
