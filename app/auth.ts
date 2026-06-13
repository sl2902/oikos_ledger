/**
 * NextAuth v5 (Auth.js) configuration — Google OAuth, JWT sessions, user provisioning.
 *
 * Google OAuth setup:
 * 1. Go to https://console.cloud.google.com
 * 2. Create a new project or select an existing one
 * 3. Navigate to APIs & Services → Credentials
 * 4. Create OAuth 2.0 Client ID (Web application type)
 * 5. Add authorized redirect URI: http://localhost:3000/api/auth/callback/google
 * 6. Copy Client ID and Client Secret into .env.local as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 */

import type { DefaultSession } from "next-auth"
import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { authConfig } from "./auth.config"
import { createUser, getUserByEmail } from "@/lib/db/queries/users"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user }) {
      if (!user.email) return false
      const existing = await getUserByEmail(user.email)
      if (!existing) {
        await createUser({
          email: user.email,
          country_code: "IN",
          currency: "INR",
        })
      }
      return true
    },

    // Runs on sign-in (user populated) and on every JWT refresh (user undefined).
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await getUserByEmail(user.email)
        if (dbUser) token["userId"] = dbUser.id
      }
      return token
    },

    async session({ session, token }) {
      if (typeof token["userId"] === "string") {
        session.user.id = token["userId"]
      }
      return session
    },
  },
})
