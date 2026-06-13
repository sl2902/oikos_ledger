// Edge-compatible auth config — no Node.js imports, used by middleware.
import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnLogin = nextUrl.pathname === "/login"

      if (isLoggedIn && isOnLogin) {
        return Response.redirect(new URL("/", nextUrl))
      }

      if (!isLoggedIn && !isOnLogin) {
        return false // NextAuth redirects to pages.signIn
      }

      return true
    },
  },
  providers: [],
} satisfies NextAuthConfig
