// apps/web/src/components/kopilot/stores/select-context.ts

import { useMemo } from 'react'
import type { ContextSlice, SessionContext, SessionRef } from '../context/types'
import { useKopilotStore } from './kopilot-store'

/**
 * Merge all registered slices into a single `SessionContext` for the LLM.
 * `page` follows last-write-wins (only one mount should own it);
 * `references` are concatenated in registration order.
 */
export function selectMergedContext(slices: Record<string, ContextSlice>): SessionContext {
  const merged: SessionContext = {}
  const references: SessionRef[] = []
  for (const slice of Object.values(slices)) {
    if (slice.page !== undefined) merged.page = slice.page
    if (slice.references.length > 0) {
      // Strip the UI-only `pinned` flag — the lib `SessionRef` doesn't
      // declare it and a strict tRPC schema would reject the extra field.
      for (const ref of slice.references) {
        const { pinned: _pinned, ...rest } = ref
        references.push(rest)
      }
    }
  }
  if (references.length > 0) merged.references = references
  return merged
}

/** Flatten surface refs across all slices in registration order. */
export function selectMergedRefs(slices: Record<string, ContextSlice>): SessionRef[] {
  return Object.values(slices).flatMap((s) => s.references)
}

/**
 * Strip dismissed surface refs from a merged SessionContext payload. Used at
 * submit time so the LLM doesn't see ids the user × dismissed for this turn.
 *
 * Dismissal keys are `<kind>:<id>`. Mention refs aren't chipped, so this only
 * affects surface refs in practice.
 */
export function applyChipDismissals(
  merged: SessionContext,
  dismissedKeys: Set<string>
): SessionContext {
  if (dismissedKeys.size === 0 || !merged.references) return merged
  const filtered = merged.references.filter((r) => !dismissedKeys.has(`${r.kind}:${r.id}`))
  if (filtered.length === merged.references.length) return merged
  const next: SessionContext = { ...merged }
  if (filtered.length > 0) {
    next.references = filtered
  } else {
    delete next.references
  }
  return next
}

// Select the raw `contextSlices` map (its reference is stable until
// `setContextSlice` / `clearContextSlice` fires) and memoize the merge.
// `useShallow` on the merged result doesn't work here: `references` is a
// freshly built array each call, so shallow equality always fails and
// `useSyncExternalStore` falls into "snapshot not cached" → update loop.
export const useMergedKopilotContext = () => {
  const slices = useKopilotStore((s) => s.contextSlices)
  return useMemo(() => selectMergedContext(slices), [slices])
}

export const useKopilotSurfaceRefs = () => {
  const slices = useKopilotStore((s) => s.contextSlices)
  return useMemo(() => selectMergedRefs(slices), [slices])
}
