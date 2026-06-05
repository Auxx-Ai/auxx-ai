// apps/web/src/components/agents/procedures/hooks/use-procedure-mutations.ts
'use client'

import type { TriggerExample } from '@auxx/lib/agents/procedures/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import type { AutosaveState } from '../../ui/shared/autosave-indicator'
import { getProcedureStoreState } from '../store/procedure-store'

/** Light trigger-meta fields written through the optimistic + debounced path. */
interface ProcedureMetaPatch {
  name?: string
  whenToUse?: string
  triggerExamples?: TriggerExample[]
  ruleset?: ConditionGroup[]
}

interface UseProcedureMutationsOptions {
  /** Lifts autosave status so the detail bar can show Saving…/Saved. */
  onStateChange?: (state: AutosaveState) => void
}

export interface UseProcedureMutationsResult {
  autosave: AutosaveState
  /** Instant optimistic store patch + debounced persist (the trigger-header write path). */
  patchMeta: (id: string, fields: ProcedureMetaPatch) => void
  /** Persist the heavy draft doc — no optimistic store write (the editor owns the doc). */
  saveDoc: (id: string, doc: Record<string, unknown>) => Promise<void>
  publish: (id: string) => Promise<void>
  revert: (id: string, toVersionId: string) => Promise<void>
  isPublishing: boolean
}

const META_DEBOUNCE_MS = 800

/**
 * The procedure draft write surface — the KB-store analogue of
 * `use-article-mutations.ts`. `patchMeta` is the fix's core: it patches the
 * optimistic store synchronously (so controlled inputs update on the same tick
 * as the keystroke) and coalesces a debounced `procedure.update`, settling with
 * a `getById` cache splice — never an invalidate, which would clobber the live
 * editor doc.
 *
 * Every external dependency (the mutation `mutateAsync`s, `utils`, the autosave
 * callback) is held in a ref so the returned callbacks stay **identity-stable**.
 * react-query's mutation result is a fresh object across renders; depending on
 * it directly would recreate the callbacks every render, which (a) resets the
 * editor's `useDebounceCallback(saveDoc)` and (b) re-fires the unmount-flush
 * effect on every render — firing a save per keystroke whose out-of-order
 * responses overwrite the field. Refs keep the debounce honest.
 */
export function useProcedureMutations({
  onStateChange,
}: UseProcedureMutationsOptions = {}): UseProcedureMutationsResult {
  const utils = api.useUtils()
  const updateProcedure = api.procedure.update.useMutation()
  const publishMutation = api.procedure.publish.useMutation()
  const revertMutation = api.procedure.revert.useMutation()

  const [autosave, setAutosave] = useState<AutosaveState>({ kind: 'idle' })

  // ── Stable refs (updated every render, read inside the callbacks) ──────
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange
  const utilsRef = useRef(utils)
  utilsRef.current = utils
  const updateAsyncRef = useRef(updateProcedure.mutateAsync)
  updateAsyncRef.current = updateProcedure.mutateAsync
  const publishAsyncRef = useRef(publishMutation.mutateAsync)
  publishAsyncRef.current = publishMutation.mutateAsync
  const revertAsyncRef = useRef(revertMutation.mutateAsync)
  revertAsyncRef.current = revertMutation.mutateAsync

  const setAutosaveAndNotify = useCallback((next: AutosaveState) => {
    setAutosave(next)
    onStateChangeRef.current?.(next)
  }, [])

  // Coalesced meta fields + their target id, flushed by one debounced timer.
  const queuedRef = useRef<{ id: string; fields: ProcedureMetaPatch } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushMeta = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const queued = queuedRef.current
    queuedRef.current = null
    if (!queued) return
    const { id, fields } = queued
    setAutosaveAndNotify({ kind: 'saving' })
    try {
      const server = await updateAsyncRef.current({ id, ...fields })
      // Splice authoritative meta into the editor query cache (keeping draftDoc)
      // instead of invalidating — a refetch would clobber the live editor doc.
      // The `useProcedure` effect then re-hydrates the store and reconciles the
      // overlay: it drops the pending entry only once the server value matches,
      // so keystrokes typed *while this request was in flight* keep winning
      // instead of snapping back. (No blunt confirmUpdate-delete here.)
      utilsRef.current.procedure.getById.setData({ id }, (prev) =>
        prev ? { ...prev, ...server } : prev
      )
      // Row pills (name/whenToUse/draft) live behind the pushed panel; marking
      // them stale refetches on back-nav rather than mid-edit.
      utilsRef.current.agentProcedure.list.invalidate()
      setAutosaveAndNotify({ kind: 'saved', at: Date.now() })
    } catch (err) {
      getProcedureStoreState().rollbackUpdate(id)
      setAutosaveAndNotify({ kind: 'idle' })
      toastError({ title: 'Save failed', description: (err as Error).message })
    }
  }, [setAutosaveAndNotify])

  const patchMeta = useCallback<UseProcedureMutationsResult['patchMeta']>(
    (id, fields) => {
      // 1. Instant: the keystroke shows immediately via the optimistic overlay.
      getProcedureStoreState().patchProcedure(id, fields)
      // 2. Debounced: coalesce queued fields and persist once after idle.
      queuedRef.current = { id, fields: { ...queuedRef.current?.fields, ...fields } }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flushMeta(), META_DEBOUNCE_MS)
    },
    [flushMeta]
  )

  const saveDoc = useCallback<UseProcedureMutationsResult['saveDoc']>(
    async (id, doc) => {
      setAutosaveAndNotify({ kind: 'saving' })
      try {
        const server = await updateAsyncRef.current({ id, doc })
        // No optimistic store write — the doc isn't in the store. Reflect only
        // the authoritative hasUnpublishedChanges so the publish pill is honest.
        getProcedureStoreState().applyMetadataFromServer(id, {
          hasUnpublishedChanges: !!server.hasUnpublishedChanges,
        })
        utilsRef.current.procedure.getById.setData({ id }, (prev) =>
          prev ? { ...prev, ...server } : prev
        )
        utilsRef.current.agentProcedure.list.invalidate()
        setAutosaveAndNotify({ kind: 'saved', at: Date.now() })
      } catch (err) {
        setAutosaveAndNotify({ kind: 'idle' })
        toastError({ title: 'Save failed', description: (err as Error).message })
      }
    },
    [setAutosaveAndNotify]
  )

  const publish = useCallback<UseProcedureMutationsResult['publish']>(async (id) => {
    try {
      await publishAsyncRef.current({ id })
      // Instant pill flip; the getById invalidate carries authoritative
      // activeVersionId + hasUnpublishedChanges (safe: the doc seeds once).
      getProcedureStoreState().applyMetadataFromServer(id, { hasUnpublishedChanges: false })
      utilsRef.current.procedure.getById.invalidate({ id })
      utilsRef.current.procedure.listVersions.invalidate({ id })
      utilsRef.current.agentProcedure.list.invalidate()
    } catch (err) {
      toastError({ title: 'Publish failed', description: (err as Error).message })
    }
  }, [])

  const revert = useCallback<UseProcedureMutationsResult['revert']>(async (id, toVersionId) => {
    try {
      await revertAsyncRef.current({ id, toVersionId })
      utilsRef.current.procedure.getById.invalidate({ id })
      utilsRef.current.procedure.listVersions.invalidate({ id })
      utilsRef.current.agentProcedure.list.invalidate()
    } catch (err) {
      toastError({ title: 'Revert failed', description: (err as Error).message })
    }
  }, [])

  // Flush any queued meta on unmount so an in-progress edit isn't lost. `flushMeta`
  // is identity-stable, so this cleanup fires ONLY on real unmount — not per render.
  useEffect(() => {
    return () => {
      if (queuedRef.current) void flushMeta()
    }
  }, [flushMeta])

  return {
    autosave,
    patchMeta,
    saveDoc,
    publish,
    revert,
    isPublishing: publishMutation.isPending,
  }
}
