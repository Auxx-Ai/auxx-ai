// apps/web/src/components/evals/stores/use-eval-suggestions-store.ts
'use client'

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { RouterOutputs } from '~/trpc/react'

/**
 * Session cache for procedure-scoped simulation suggestions. `eval.suggest` spends
 * tokens, so its result is held here keyed by `procedureId` instead of in the
 * section's component state — which is lost whenever the list panel unmounts
 * (drilling into a case, switching tabs) and would otherwise re-run the model on
 * every re-expand. Survives remounts; resets on reload (the v1 "ephemeral, cached
 * per draft revision" contract — see plans/evals/phase-3-suggester.md §3.4).
 *
 * Staleness after a draft edit is handled by the explicit **Refresh** action
 * (`setResult` overwrites the entry); the result carries the `draftHash` it ran
 * against. Selectors only (CLAUDE.md Zustand rule).
 */

type SuggestResult = RouterOutputs['eval']['suggest']

export interface SuggestionsEntry {
  result: SuggestResult
  /** Session-only dismissals, kept here so they survive a section remount too. */
  dismissed: Set<string>
}

interface EvalSuggestionsStore {
  byProcedure: Record<string, SuggestionsEntry>
  /**
   * Procedures a generation has been kicked off for this session — so the
   * default-open section auto-generates exactly once and a *failed* attempt
   * doesn't re-fire on every remount (the user re-runs it with Refresh).
   */
  requested: Record<string, boolean>
  /** Record that a generation was started for this procedure. */
  markRequested: (procedureId: string) => void
  /** Cache (or overwrite, on Refresh) a generation, preserving any dismissals. */
  setResult: (procedureId: string, result: SuggestResult) => void
  dismiss: (procedureId: string, suggestionId: string) => void
}

export const useEvalSuggestionsStore = create<EvalSuggestionsStore>((set) => ({
  byProcedure: {},
  requested: {},

  markRequested: (procedureId) =>
    set((s) => ({ requested: { ...s.requested, [procedureId]: true } })),

  setResult: (procedureId, result) =>
    set((s) => ({
      byProcedure: {
        ...s.byProcedure,
        [procedureId]: { result, dismissed: s.byProcedure[procedureId]?.dismissed ?? new Set() },
      },
    })),

  dismiss: (procedureId, suggestionId) =>
    set((s) => {
      const cur = s.byProcedure[procedureId]
      if (!cur) return s
      const dismissed = new Set(cur.dismissed)
      dismissed.add(suggestionId)
      return { byProcedure: { ...s.byProcedure, [procedureId]: { ...cur, dismissed } } }
    }),
}))

const EMPTY_DISMISSED: ReadonlySet<string> = new Set()

/** Selector: the cached generation, dismissals, and request flag for one procedure. */
export function useSuggestionsEntry(procedureId: string): {
  result: SuggestResult | null
  dismissed: ReadonlySet<string>
  requested: boolean
} {
  return useEvalSuggestionsStore(
    useShallow((s) => {
      const entry = s.byProcedure[procedureId]
      return {
        result: entry?.result ?? null,
        dismissed: entry?.dismissed ?? EMPTY_DISMISSED,
        requested: s.requested[procedureId] ?? false,
      }
    })
  )
}

/** Selector: the store actions (shallow-compared so the object ref stays stable). */
export function useEvalSuggestionsActions() {
  return useEvalSuggestionsStore(
    useShallow((s) => ({
      setResult: s.setResult,
      dismiss: s.dismiss,
      markRequested: s.markRequested,
    }))
  )
}
