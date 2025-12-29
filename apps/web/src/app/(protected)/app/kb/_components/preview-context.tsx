import React from 'react'
import { RouterOutputs } from '~/trpc/react'

/**
 * Types ------------------------------------------------------------------
 */

type KBType = RouterOutputs['kb']['byId']

export type Theme = 'light' | 'dark'
export type Device = 'desktop' | 'mobile'

interface PreviewContextValue {
  /** Raw knowledge‑base data coming from tRPC */
  knowledgeBase?: KBType
  /** Whether the KB data is still loading */
  isLoading: boolean
  /** Convenience booleans so consuming components don’t re‑implement checks */
  isDark: boolean
  isMobile: boolean
  /** Updaters ------------------------------------------------------------ */
  setTheme: (t: Theme) => void
  setDevice: (d: Device) => void
}

/**
 * Context ----------------------------------------------------------------
 */
const PreviewContext = React.createContext<PreviewContextValue | undefined>(undefined)

/**
 * Helpers ----------------------------------------------------------------
 */
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  // 1️⃣ honour stored preference
  const stored = localStorage.getItem('kb-theme') as Theme | null
  if (stored) return stored
  // 2️⃣ fallback to system preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Provider ---------------------------------------------------------------
 */
interface PreviewProviderProps {
  children: React.ReactNode
  knowledgeBase?: KBType
}

export const PreviewProvider: React.FC<PreviewProviderProps> = ({ children, knowledgeBase }) => {
  /* ------------------------------------------------------------------
   * State                                                                */
  const [theme, setTheme] = React.useState<Theme>(getInitialTheme)
  const [device, setDevice] = React.useState<Device>('desktop')
  const [isLoading, setIsLoading] = React.useState(!knowledgeBase)

  /* ------------------------------------------------------------------
   * Side‑effects                                                         */
  // Sync loading flag when KB arrives
  React.useEffect(() => {
    setIsLoading(!knowledgeBase)
  }, [knowledgeBase])

  // ️️Sync <html class="dark"/> flag + persist to localStorage
  // React.useEffect(() => {
  //   if (typeof document === 'undefined') return
  //   const root = document.documentElement
  //   root.classList.toggle('dark', theme === 'dark')
  //   if (typeof localStorage !== 'undefined') {
  //     localStorage.setItem('kb-theme', theme)
  //   }
  // }, [theme])

  /* ------------------------------------------------------------------
   * Memoised context value                                               */
  const value = React.useMemo<PreviewContextValue>(
    () => ({
      knowledgeBase,
      isLoading,
      isDark: theme === 'dark',
      isMobile: device === 'mobile',
      setTheme,
      setDevice,
    }),
    [knowledgeBase, isLoading, theme, device]
  )

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

/**
 * Hook -------------------------------------------------------------------
 */
export function usePreview(): PreviewContextValue {
  const ctx = React.useContext(PreviewContext)
  if (!ctx) {
    throw new Error('usePreview must be used within a <PreviewProvider />')
  }
  return ctx
}
