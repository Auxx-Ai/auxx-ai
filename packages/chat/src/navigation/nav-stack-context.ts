// packages/chat/src/navigation/nav-stack-context.ts
//
// Lets any frame view call `useNavStack()` to push/pop without prop drilling.
// The provider lives in widget.tsx and supplies whichever tab's stack is
// currently active.

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { NavStack } from './use-navigation-stack'

const NavStackContext = createContext<NavStack | null>(null)

export const NavStackProvider = NavStackContext.Provider

export function useNavStack(): NavStack {
  const ctx = useContext(NavStackContext)
  if (!ctx) throw new Error('useNavStack must be used within a NavStackProvider')
  return ctx
}
