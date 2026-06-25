"use client"

import { createContext, useContext } from "react"

const GuestContext = createContext(false)

export function GuestProvider({ isGuest, children }: {
  isGuest: boolean
  children: React.ReactNode
}) {
  return (
    <GuestContext.Provider value={isGuest}>
      {children}
    </GuestContext.Provider>
  )
}

export function useGuest() {
  return useContext(GuestContext)
}
