// apps/web/src/components/kopilot/stores/select-suggestions.ts

import { useShallow } from 'zustand/react/shallow'
import type { SuggestionSlice } from '../suggestions/types'
import { useKopilotStore } from './kopilot-store'

/**
 * Sort registered suggestion slices into render order: higher `priority` first,
 * stable mount-order tiebreak via `Object.values` insertion-order semantics.
 */
export function selectMergedSuggestions(
  slices: Record<string, SuggestionSlice>
): SuggestionSlice[] {
  const list = Object.values(slices)
  // Stable sort by priority desc; mount-order preserved for equal priority.
  return list.slice().sort((a, b) => b.priority - a.priority)
}

// `useShallow` is required: this selector builds a fresh array on every call.
// Zustand v5 (built on `useSyncExternalStore`) requires snapshot stability.
export const useKopilotSuggestions = () =>
  useKopilotStore(useShallow((s) => selectMergedSuggestions(s.suggestionSlices)))
