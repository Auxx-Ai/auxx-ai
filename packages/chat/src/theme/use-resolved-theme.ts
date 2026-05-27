// packages/chat/src/theme/use-resolved-theme.ts

import { useEffect, useState } from 'preact/hooks'

type Theme = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

interface Args {
  scriptTheme: Theme | undefined
  adminTheme: Theme
}

function getOsDark(): boolean {
  return typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

/** Returns the resolved 'light' | 'dark' theme. Re-renders when the OS
 * preference flips (only when the effective theme is 'system'). */
export function useResolvedTheme({ scriptTheme, adminTheme }: Args): Resolved {
  const effectiveTheme = scriptTheme ?? adminTheme
  const [osDark, setOsDark] = useState(getOsDark)

  useEffect(() => {
    if (effectiveTheme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setOsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [effectiveTheme])

  if (effectiveTheme === 'light') return 'light'
  if (effectiveTheme === 'dark') return 'dark'
  return osDark ? 'dark' : 'light'
}
