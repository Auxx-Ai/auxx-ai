// apps/web/src/components/dashboard/hooks/use-dashboard-autosave.ts
'use client'

// Auto-save the editable draft to the server. Subscribes to the store's `isDirty`
// flag (set by every draft mutation), debounces, and flushes the whole draft doc
// through `api.dashboard.saveDraft` — which persists `Dashboard.draftLayout` and
// returns the reconciled `hasUnpublishedChanges` (drives the pill). No version is
// created; publishing is a separate explicit action (`use-dashboard-publish`).
//
// The store owns state; this hook owns the network + timer. It flushes on unmount
// so a fast tab-away doesn't drop the last edit.
//
// TWO GUARDS make that safe with a second writer on the draft (plan v3/04 §7):
//
//  1. a compare-and-set token. The flush sends the WHOLE document, so a flush
//     holding a doc from before someone else's write is a complete overwrite.
//     `expectedLayoutHash` is the hash of the doc this client last saw from the
//     server; a mismatch comes back as a `ConflictError` instead of a silent
//     clobber. Two browser tabs already race this way today; a Kopilot turn
//     makes it routine.
//  2. suspension while a Kopilot turn holds the lock, including on unmount.
//     Closing the tab mid-turn used to flush a pre-turn document over
//     everything the agent had written. The CAS turns that into a conflict,
//     which is the real fix; the suspension is what stops it being a conflict
//     the user has to think about.

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef } from 'react'
import { api } from '~/trpc/react'
import { getDashboardDraftState, useDashboardStore } from '../stores/dashboard-draft-store'
import { getDashboardTurnLock } from './use-dashboard-kopilot-turn'

const DEBOUNCE_MS = 800

interface UseDashboardAutosaveArgs {
  /** The open dashboard. Resets the CAS token when it changes. */
  dashboardId: string | null
  /**
   * `dashboard.get`'s `draftLayoutHash` — the hash of the stored draft this
   * page last saw. `null` for a row that has never held a draft (there is
   * nothing that could have moved under us, so that first write is unguarded);
   * `undefined` while the query is still loading.
   *
   * Threaded as an ARGUMENT rather than through the draft store: the store and
   * `use-dashboard-draft-sync` are owned elsewhere, and the token is not draft
   * state — it is a per-connection fact about the last server response, which
   * is exactly what a hook-local ref is for.
   */
  seedLayoutHash?: string | null
}

export function useDashboardAutosave({ dashboardId, seedLayoutHash }: UseDashboardAutosaveArgs) {
  const saveDraft = api.dashboard.saveDraft.useMutation()
  const utils = api.useUtils()
  const setSaveState = useDashboardStore((s) => s.setSaveState)
  const setHasUnpublishedChanges = useDashboardStore((s) => s.setHasUnpublishedChanges)
  const adoptDraft = useDashboardStore((s) => s.adoptDraft)

  const saveRef = useRef(saveDraft)
  saveRef.current = saveDraft

  /**
   * The CAS token for the next flush. Seeded from the server response below and
   * then advanced by each save's own `layoutHash`, so a burst of edits chains
   * without a re-read.
   */
  const layoutHashRef = useRef<string | null>(null)
  const savingRef = useRef(false)

  // Adopt the token from whatever `dashboard.get` last returned. Skipped while
  // an edit is pending or a flush is in flight: those hold a NEWER token (the
  // one the last save returned) that a late query result would regress, and a
  // regressed token is a false conflict. `isDirty` is read imperatively and is
  // deliberately not a dependency — a seed dropped for that reason is replaced
  // by the more accurate token the in-flight save is about to return.
  useEffect(() => {
    if (seedLayoutHash === undefined) return
    const state = getDashboardDraftState()
    // Only for the dashboard this hook is mounted for. A seed landing for a
    // different one is a late response from the dashboard just navigated away
    // from, and adopting it would hand the new dashboard a foreign token.
    if (state.dashboardId !== dashboardId) return
    if (state.isDirty || savingRef.current) return
    layoutHashRef.current = seedLayoutHash
  }, [dashboardId, seedLayoutHash])

  const flush = useCallback(async () => {
    const s = getDashboardDraftState()
    if (!s.isEditMode || !s.draft || !s.dashboardId || !s.isDirty) return
    // Suspended for the span of a Kopilot turn. Checked HERE, not only on the
    // debounce, so the unmount flush respects it too.
    if (getDashboardTurnLock(s.dashboardId)) return
    const id = s.dashboardId
    const doc = s.draft
    const expectedLayoutHash = layoutHashRef.current
    // Clear dirty BEFORE the request; a mutation arriving mid-flight re-sets it
    // and re-triggers the debounce, so the newest doc is always eventually saved.
    useDashboardStore.setState({ isDirty: false })
    savingRef.current = true
    setSaveState('saving')
    try {
      const result = await saveRef.current.mutateAsync({
        id,
        doc,
        ...(expectedLayoutHash ? { expectedLayoutHash } : {}),
      })
      // Chain the returned token into the next flush; no re-read needed.
      layoutHashRef.current = result.layoutHash
      setHasUnpublishedChanges(result.hasUnpublishedChanges)
      setSaveState('saved')
    } catch (error) {
      if (isConflict(error)) {
        // The stored draft moved under us: another tab, or the Kopilot turn we
        // were suspended for. Re-setting `isDirty` here (what a network failure
        // does, "so a later edit retries") is precisely wrong — retrying the
        // same stale document IS the clobber the CAS just prevented. Refetch,
        // adopt, and let the user redo the edit against the current doc.
        setSaveState('error')
        try {
          // `staleTime: 0`: the whole point is the server's CURRENT draft, and
          // the query client's 30s default would hand back the very doc the
          // conflict just proved stale.
          const fresh = await utils.dashboard.get.fetch({ id }, { staleTime: 0 })
          if (fresh && getDashboardDraftState().dashboardId === id) {
            layoutHashRef.current = fresh.draftLayoutHash
            adoptDraft(fresh.draftLayout ?? fresh.layout, fresh.hasUnpublishedChanges)
          }
        } catch {
          // The refetch is best effort. Failing it leaves the canvas showing
          // the doc the user has, which the next flush will conflict on again —
          // annoying, never destructive.
        }
        toastError({
          title: 'Your changes were not saved',
          description:
            'This dashboard changed somewhere else while you were editing, so the canvas has ' +
            'been refreshed to the latest version. Please redo your last edit.',
        })
        return
      }
      useDashboardStore.setState({ isDirty: true }) // keep dirty so a later edit retries
      setSaveState('error')
      toastError({
        title: 'Auto-save failed',
        description: error instanceof Error ? error.message : 'Could not save your changes.',
      })
    } finally {
      savingRef.current = false
    }
  }, [setSaveState, setHasUnpublishedChanges, adoptDraft, utils])

  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useDashboardStore.subscribe(
      (s) => s.isDirty,
      (isDirty) => {
        const state = getDashboardDraftState()
        if (!isDirty || !state.isEditMode) return
        // Don't even arm the timer during a turn. The edit stays dirty and the
        // next mutation after the lock releases re-arms it, so nothing is lost.
        if (getDashboardTurnLock(state.dashboardId)) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void flushRef.current(), DEBOUNCE_MS)
      }
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
      // Flush a pending edit on unmount so navigating away doesn't drop it.
      // `flush` re-checks the turn lock, which is the sharpest edge here: a user
      // closing the tab mid-turn must not push a pre-turn document over the
      // agent's work.
      if (getDashboardDraftState().isDirty) void flushRef.current()
    }
  }, [])
}

/**
 * A `ConflictError` from `saveDraft`, as tRPC delivers it. `auxxErrorMiddleware`
 * maps the 409 to tRPC's `CONFLICT`, so the code is the check — never the
 * message, and never `instanceof`, which cannot survive the wire.
 */
function isConflict(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === 'CONFLICT'
}
