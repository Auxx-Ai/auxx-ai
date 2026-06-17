// apps/web/src/components/kbar/contextual/command-context.tsx
'use client'

import { createContext, type ReactNode, useContext, useEffect, useId } from 'react'
import { useContextualActionsStore } from './contextual-store'
import type { CommandScope } from './types'

/**
 * Internal React context carrying the enclosing scope's group label down to
 * descendant `<CommandAction>`s. A flat sibling default can't disambiguate once
 * two scopes coexist (record drawer over a live table), so group inheritance is
 * provider-scoped rather than "active context wins".
 */
const ScopeContext = createContext<{ groupLabel: string } | null>(null)

/** Read the enclosing scope's default group label (or `null` at the root). */
export function useScopeGroupLabel(): string | null {
  return useContext(ScopeContext)?.groupLabel ?? null
}

interface CommandContextProps extends CommandScope {
  children?: ReactNode
}

/**
 * Distributed command-palette scope contributor. Mount one (or many) on a
 * surface; each mount registers a scope slice while alive and clears it on
 * unmount. Descendant `<CommandAction>`s inherit its `label` as their default
 * group and can read the payload via `useCommandScope()`.
 *
 * Props are primitives so React's default dep-comparison drives effect re-runs.
 * Render self-closing to contribute only the payload (supplies no default group).
 */
export function CommandContext({
  label,
  kind,
  recordId,
  entityDefinitionId,
  priority,
  children,
}: CommandContextProps) {
  const id = useId()
  const setSlice = useContextualActionsStore((s) => s.setContextSlice)
  const clearSlice = useContextualActionsStore((s) => s.clearContextSlice)

  useEffect(() => {
    setSlice(id, {
      id,
      label,
      kind,
      ...(recordId ? { recordId } : {}),
      ...(entityDefinitionId ? { entityDefinitionId } : {}),
      ...(priority !== undefined ? { priority } : {}),
    })
    return () => clearSlice(id)
  }, [id, label, kind, recordId, entityDefinitionId, priority, setSlice, clearSlice])

  if (children === undefined) return null
  return <ScopeContext.Provider value={{ groupLabel: label }}>{children}</ScopeContext.Provider>
}
