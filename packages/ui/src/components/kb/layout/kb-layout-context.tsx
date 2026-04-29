// packages/ui/src/components/kb/layout/kb-layout-context.tsx
'use client'

import { createContext, useContext } from 'react'

export interface KBLayoutContextValue {
  kbId: string
  collapsed: boolean
  setCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void
  mobileOpen: boolean
  setMobileOpen: (value: boolean) => void
  searchOpen: boolean
  setSearchOpen: (value: boolean) => void
}

const KBLayoutContext = createContext<KBLayoutContextValue | null>(null)

export const KBLayoutContextProvider = KBLayoutContext.Provider

export function useKBLayoutContext(): KBLayoutContextValue {
  const ctx = useContext(KBLayoutContext)
  if (!ctx) throw new Error('useKBLayoutContext must be used within <KBLayoutShell>')
  return ctx
}

export function useKBLayoutContextOptional(): KBLayoutContextValue | null {
  return useContext(KBLayoutContext)
}
