// apps/chat-widget/src/navigation/use-navigation-stack.ts
//
// Per-tab navigation stack. Modeled on the React `CommandNavigation` pattern
// in `@auxx/ui/components/command` but stripped of the keyboard surface and
// search flag (the widget has neither), and extended with `replace` so the
// Messages list can swap the top thread frame without growing the stack.

import { useCallback, useMemo, useState } from 'preact/hooks'

export type NavView = 'home' | 'messages' | 'thread' | 'kb-section' | 'kb-article'

export interface NavFrame {
  id: string
  label: string
  view: NavView
  params?: Record<string, unknown>
}

export interface NavStack {
  stack: NavFrame[]
  current: NavFrame | null
  isAtRoot: boolean
  push: (frame: NavFrame) => void
  pop: () => void
  navigateTo: (index: number) => void
  reset: () => void
  replace: (frame: NavFrame) => void
}

export function useNavigationStack(initialStack: NavFrame[] = []): NavStack {
  const [stack, setStack] = useState<NavFrame[]>(initialStack)

  const push = useCallback((frame: NavFrame) => {
    setStack((prev) => [...prev, frame])
  }, [])

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev))
  }, [])

  const navigateTo = useCallback((index: number) => {
    setStack((prev) => prev.slice(0, Math.max(0, index + 1)))
  }, [])

  const reset = useCallback(() => {
    setStack([])
  }, [])

  const replace = useCallback((frame: NavFrame) => {
    setStack((prev) => (prev.length === 0 ? [frame] : [...prev.slice(0, -1), frame]))
  }, [])

  return useMemo<NavStack>(
    () => ({
      stack,
      current: stack.length > 0 ? stack[stack.length - 1] : null,
      isAtRoot: stack.length === 0,
      push,
      pop,
      navigateTo,
      reset,
      replace,
    }),
    [stack, push, pop, navigateTo, reset, replace]
  )
}
