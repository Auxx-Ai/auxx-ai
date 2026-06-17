// apps/web/src/components/kbar/contextual/select-contextual.ts
'use client'

import { useMemo } from 'react'
import type { PaletteAction, PaletteSection } from '../types'
import { useContextualActionsStore } from './contextual-store'
import type { CommandActionSlice, CommandContextSlice, CommandScope } from './types'

/**
 * Build the contextual `PaletteSection[]` from the raw slice maps.
 *
 * - Group `actionSlices` by their resolved `group` label.
 * - Order groups by the matching context slice's `priority` (desc). Groups with
 *   no matching context slice sort last, stable by first-seen order.
 * - Within a group, order actions by `priority` (desc) then registration order.
 */
export function selectContextualSections(
  actions: Record<string, CommandActionSlice>,
  contexts: Record<string, CommandContextSlice>
): PaletteSection[] {
  const actionList = Object.values(actions)
  if (actionList.length === 0) return []

  // Highest priority context per label (the group heading derives its order
  // from the scope that owns it).
  const contextByLabel = new Map<string, CommandContextSlice>()
  for (const ctx of Object.values(contexts)) {
    const existing = contextByLabel.get(ctx.label)
    if (!existing || (ctx.priority ?? 0) > (existing.priority ?? 0)) {
      contextByLabel.set(ctx.label, ctx)
    }
  }

  // Group actions, preserving first-seen order for the group list.
  const groups = new Map<string, CommandActionSlice[]>()
  for (const action of actionList) {
    const bucket = groups.get(action.group)
    if (bucket) bucket.push(action)
    else groups.set(action.group, [action])
  }

  const ordered = Array.from(groups.entries()).map(([label, slices], index) => ({
    label,
    slices,
    priority: contextByLabel.get(label)?.priority ?? Number.NEGATIVE_INFINITY,
    index,
  }))

  // Group order: priority desc, first-seen tiebreak.
  ordered.sort((a, b) => b.priority - a.priority || a.index - b.index)

  return ordered.map(({ label, slices }) => ({
    label,
    actions: slices
      .slice()
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map(sliceToAction),
  }))
}

function sliceToAction(slice: CommandActionSlice): PaletteAction {
  return {
    id: slice.id,
    label: slice.label,
    ...(slice.subtitle ? { subtitle: slice.subtitle } : {}),
    ...(slice.icon ? { icon: slice.icon } : {}),
    ...(slice.keywords ? { keywords: slice.keywords } : {}),
    ...(slice.shortcut ? { shortcut: slice.shortcut } : {}),
    ...(slice.disabled ? { disabled: slice.disabled } : {}),
    perform: slice.perform,
  }
}

/**
 * Read the raw slice maps and memoize the section build. `useShallow` on the
 * result does NOT work here: `selectContextualSections` returns freshly built
 * objects each call, so shallow equality always fails and `useSyncExternalStore`
 * falls into a "snapshot not cached" update loop (the documented
 * `kopilot/stores/select-context.ts:59` caveat). Memoize over the raw maps —
 * their identity is stable until a slice is set/cleared.
 */
export const useContextualSections = (): PaletteSection[] => {
  const actions = useContextualActionsStore((s) => s.actionSlices)
  const contexts = useContextualActionsStore((s) => s.contextSlices)
  return useMemo(() => selectContextualSections(actions, contexts), [actions, contexts])
}

/**
 * The highest-priority active scope payload (or `null`), for shared action
 * helpers that read the live scope (e.g. `<RecordCommandActions>`).
 */
export const useCommandScope = (): CommandScope | null => {
  const contexts = useContextualActionsStore((s) => s.contextSlices)
  return useMemo(() => {
    let best: CommandContextSlice | null = null
    for (const ctx of Object.values(contexts)) {
      if (!best || (ctx.priority ?? 0) > (best.priority ?? 0)) best = ctx
    }
    return best
  }, [contexts])
}
