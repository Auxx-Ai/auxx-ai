// apps/web/src/components/kb/ui/preview/preview-context.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import React from 'react'
import type { KnowledgeBase } from '../../store/knowledge-base-store'

export type Theme = 'light' | 'dark'
export type Device = 'desktop' | 'mobile'

interface PreviewContextValue {
  knowledgeBase?: KnowledgeBase
  isLoading: boolean
  isDark: boolean
  isMobile: boolean
  setTheme: (t: Theme) => void
  setDevice: (d: Device) => void
}

const PreviewContext = React.createContext<PreviewContextValue | undefined>(undefined)

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem('kb-theme') as Theme | null
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface PreviewProviderProps {
  children: React.ReactNode
  knowledgeBase?: KnowledgeBase
}

export function PreviewProvider({ children, knowledgeBase }: PreviewProviderProps) {
  const [theme, setTheme] = React.useState<Theme>(getInitialTheme)
  const [device, setDevice] = React.useState<Device>('desktop')
  const [isLoading, setIsLoading] = React.useState(!knowledgeBase)

  React.useEffect(() => {
    setIsLoading(!knowledgeBase)
  }, [knowledgeBase])

  // Merge pending draft on top of live columns so the preview iframe reflects
  // unpublished settings while the public site stays untouched.
  const merged = React.useMemo(
    () =>
      knowledgeBase
        ? (mergeDraftOverLive(knowledgeBase as Record<string, unknown>) as KnowledgeBase)
        : knowledgeBase,
    [knowledgeBase]
  )

  const value = React.useMemo<PreviewContextValue>(
    () => ({
      knowledgeBase: merged,
      isLoading,
      isDark: theme === 'dark',
      isMobile: device === 'mobile',
      setTheme,
      setDevice,
    }),
    [merged, isLoading, theme, device]
  )

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

export function usePreview(): PreviewContextValue {
  const ctx = React.useContext(PreviewContext)
  if (!ctx) throw new Error('usePreview must be used within a <PreviewProvider />')
  return ctx
}
