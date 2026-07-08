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

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef } from 'react'
import { api } from '~/trpc/react'
import { getDashboardDraftState, useDashboardStore } from '../stores/dashboard-draft-store'

const DEBOUNCE_MS = 800

export function useDashboardAutosave() {
  const saveDraft = api.dashboard.saveDraft.useMutation()
  const setSaveState = useDashboardStore((s) => s.setSaveState)
  const setHasUnpublishedChanges = useDashboardStore((s) => s.setHasUnpublishedChanges)

  const saveRef = useRef(saveDraft)
  saveRef.current = saveDraft

  const flush = useCallback(async () => {
    const s = getDashboardDraftState()
    if (!s.isEditMode || !s.draft || !s.dashboardId || !s.isDirty) return
    const id = s.dashboardId
    const doc = s.draft
    // Clear dirty BEFORE the request; a mutation arriving mid-flight re-sets it
    // and re-triggers the debounce, so the newest doc is always eventually saved.
    useDashboardStore.setState({ isDirty: false })
    setSaveState('saving')
    try {
      const result = await saveRef.current.mutateAsync({ id, doc })
      setHasUnpublishedChanges(result.hasUnpublishedChanges)
      setSaveState('saved')
    } catch (error) {
      useDashboardStore.setState({ isDirty: true }) // keep dirty so a later edit retries
      setSaveState('error')
      toastError({
        title: 'Auto-save failed',
        description: error instanceof Error ? error.message : 'Could not save your changes.',
      })
    }
  }, [setSaveState, setHasUnpublishedChanges])

  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useDashboardStore.subscribe(
      (s) => s.isDirty,
      (isDirty) => {
        if (!isDirty || !getDashboardDraftState().isEditMode) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void flushRef.current(), DEBOUNCE_MS)
      }
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
      // Flush a pending edit on unmount so navigating away doesn't drop it.
      if (getDashboardDraftState().isDirty) void flushRef.current()
    }
  }, [])
}
