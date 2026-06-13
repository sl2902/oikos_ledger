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
      <CardContent>
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
      </CardContent>
    </Card>
  )
}
