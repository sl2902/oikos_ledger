import { signIn } from "@/auth"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Oikos Ledger
        </CardTitle>
        <CardDescription>Your household financial intelligence</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          action={async () => {
            "use server"
            await signIn("google", { redirectTo: "/" })
          }}
        >
          <Button type="submit" className="w-full">
            Continue with Google
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form
          action={async () => {
            "use server"
            await signIn("guest", { redirectTo: "/" })
          }}
        >
          <Button type="submit" variant="outline" className="w-full">
            Try as Guest
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Guest mode uses pre-loaded demo data. No account required.
        </p>
      </CardContent>
    </Card>
  )
}
