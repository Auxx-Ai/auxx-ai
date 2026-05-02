// apps/web/src/components/kopilot/stores/select-context.ts

import { useShallow } from 'zustand/react/shallow'
import type { ContextChip, ContextSlice, SessionContext } from '../context/types'
import { useKopilotStore } from './kopilot-store'

/**
 * Merge all registered slices into a single SessionContext for the LLM.
 * Last-write-wins on key collisions (deterministic enough for our needs;
 * a context field should be owned by exactly one mount).
 */
export function selectMergedContext(slices: Record<string, ContextSlice>): SessionContext {
  const merged: SessionContext = {}
  for (const slice of Object.values(slices)) {
    Object.assign(merged, slice.data)
  }
  return merged
}

/** Flatten chips across all slices in registration order. */
export function selectMergedChips(slices: Record<string, ContextSlice>): ContextChip[] {
  return Object.values(slices).flatMap((s) => s.chips)
}

/**
 * Strip dismissed chips from a merged SessionContext payload. Used at submit
 * time so the LLM doesn't see ids the user × dismissed for this turn.
 *
 * Drops the field by name. Two slices contributing the same field is an
 * out-of-spec mount-tree bug, not a case we need to handle here.
 */
export function applyChipDismissals(
  merged: SessionContext,
  dismissedKeys: Set<string>
): SessionContext {
  if (dismissedKeys.size === 0) return merged
  const next: SessionContext = { ...merged }
  for (const key of dismissedKeys) {
    const sep = key.indexOf(':')
    if (sep < 0) continue
    const field = key.slice(0, sep) as keyof SessionContext
    delete next[field]
  }
  return next
}

// `useShallow` is required: the selectors below build a fresh object/array on
// every call. Zustand v5 (built on `useSyncExternalStore`) requires snapshot
// stability — without `useShallow`, React throws "The result of getServerSnapshot
// should be cached to avoid an infinite loop."
export const useMergedKopilotContext = () =>
  useKopilotStore(useShallow((s) => selectMergedContext(s.contextSlices)))

export const useKopilotContextChips = () =>
  useKopilotStore(useShallow((s) => selectMergedChips(s.contextSlices)))
