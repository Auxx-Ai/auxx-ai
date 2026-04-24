// apps/extension/src/iframe/hooks/use-route-stack.ts

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { INITIAL_STACK, type Route, type RouteStack } from '../routes/types'

type RouteStackContextValue = {
  stack: RouteStack
  top: Route
  depth: number
  push: (route: Route) => void
  pop: () => void
  replace: (route: Route) => void
  reset: () => void
}

const RouteStackContext = createContext<RouteStackContextValue | null>(null)

export function useRouteStack(): RouteStackContextValue {
  const ctx = useContext(RouteStackContext)
  if (!ctx) throw new Error('useRouteStack must be used inside <RouteStackProvider>')
  return ctx
}

export function useRouteStackValue(): RouteStackContextValue {
  const [stack, setStack] = useState<RouteStack>(INITIAL_STACK)

  const push = useCallback((route: Route) => {
    setStack((prev) => [...prev, route] as RouteStack)
  }, [])

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? (prev.slice(0, -1) as RouteStack) : prev))
  }, [])

  const replace = useCallback((route: Route) => {
    setStack((prev) => {
      const next = [...prev.slice(0, -1), route]
      return next as RouteStack
    })
  }, [])

  const reset = useCallback(() => setStack(INITIAL_STACK), [])

  return useMemo(
    () => ({
      stack,
      top: stack[stack.length - 1]!,
      depth: stack.length,
      push,
      pop,
      replace,
      reset,
    }),
    [stack, push, pop, replace, reset]
  )
}

export { RouteStackContext }
