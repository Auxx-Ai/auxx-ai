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
  /**
   * Restore an older version into the draft + mark dirty (restore-as-draft —
   * the active version is unchanged until publish). Resolves `true` on success.
   */
  restoreVersion: (id: string, toVersionId: string) => Promise<boolean>
  /** Rename a published version's label. */
  renameVersion: (id: string, versionId: string, label: string | null) => Promise<void>
  /** Drop draft edits back to the live version. Resolves `true` on success. */
  discardDraft: (id: string) => Promise<boolean>
  /** Delete the procedure org-wide (cascade-detaches every agent). Resolves `true` on success. */
  deleteProcedure: (id: string) => Promise<boolean>
  isPublishing: boolean
  isDiscarding: boolean
  isDeleting: boolean
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
  const restoreVersionMutation = api.procedure.restoreVersion.useMutation()
  const renameVersionMutation = api.procedure.renameVersion.useMutation()
  const discardMutation = api.procedure.discardDraft.useMutation()
  const deleteMutation = api.procedure.delete.useMutation()

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
  const restoreVersionAsyncRef = useRef(restoreVersionMutation.mutateAsync)
  restoreVersionAsyncRef.current = restoreVersionMutation.mutateAsync
  const renameVersionAsyncRef = useRef(renameVersionMutation.mutateAsync)
  renameVersionAsyncRef.current = renameVersionMutation.mutateAsync
  const discardAsyncRef = useRef(discardMutation.mutateAsync)
  discardAsyncRef.current = discardMutation.mutateAsync
  const deleteAsyncRef = useRef(deleteMutation.mutateAsync)
  deleteAsyncRef.current = deleteMutation.mutateAsync

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
        // Splice the just-saved doc into the cache alongside the authoritative
        // meta (the server projection omits draftDoc). Keeps `draftDoc` consumers
        // that aren't the editor — the eval case editor's procedure-scoped tool
        // list — in sync with added/removed `tool:` chips without a reload.
        // setData (not invalidate) is safe: the uncontrolled editor seeds once
        // via loadedRef and ignores later cache writes, so it isn't clobbered.
        utilsRef.current.procedure.getById.setData({ id }, (prev) =>
          prev ? { ...prev, ...server, draftDoc: doc } : prev
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

  const restoreVersion = useCallback<UseProcedureMutationsResult['restoreVersion']>(
    async (id, toVersionId) => {
      try {
        await restoreVersionAsyncRef.current({ id, toVersionId })
        // Restore-as-draft: the active version is unchanged; the draft is now
        // dirty (it holds the restored doc/criteria) until the user publishes.
        getProcedureStoreState().applyMetadataFromServer(id, { hasUnpublishedChanges: true })
        // Await the refetch so the rewritten draft doc is in cache BEFORE the
        // caller remounts the editor (the reload token) — otherwise the remount
        // re-seeds from the stale cached doc. listVersions/agentProcedure can
        // settle in the background.
        await utilsRef.current.procedure.getById.invalidate({ id })
        utilsRef.current.procedure.listVersions.invalidate({ id })
        utilsRef.current.agentProcedure.list.invalidate()
        return true
      } catch (err) {
        toastError({ title: 'Restore failed', description: (err as Error).message })
        return false
      }
    },
    []
  )

  const renameVersion = useCallback<UseProcedureMutationsResult['renameVersion']>(
    async (id, versionId, label) => {
      try {
        await renameVersionAsyncRef.current({ id, versionId, label })
        utilsRef.current.procedure.listVersions.invalidate({ id })
      } catch (err) {
        toastError({ title: 'Rename failed', description: (err as Error).message })
      }
    },
    []
  )

  const discardDraft = useCallback<UseProcedureMutationsResult['discardDraft']>(async (id) => {
    try {
      const server = await discardAsyncRef.current({ id })
      getProcedureStoreState().applyMetadataFromServer(id, {
        hasUnpublishedChanges: !!server.hasUnpublishedChanges,
      })
      // The draft doc was rewritten server-side; await the refetch so the
      // caller's editor remount re-seeds from the live doc, not the stale one.
      await utilsRef.current.procedure.getById.invalidate({ id })
      utilsRef.current.agentProcedure.list.invalidate()
      return true
    } catch (err) {
      toastError({ title: 'Discard failed', description: (err as Error).message })
      return false
    }
  }, [])

  const deleteProcedure = useCallback<UseProcedureMutationsResult['deleteProcedure']>(
    async (id) => {
      try {
        await deleteAsyncRef.current({ id })
        utilsRef.current.agentProcedure.list.invalidate()
        utilsRef.current.procedure.list.invalidate()
        return true
      } catch (err) {
        toastError({ title: 'Delete failed', description: (err as Error).message })
        return false
      }
    },
    []
  )

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
    restoreVersion,
    renameVersion,
    discardDraft,
    deleteProcedure,
    isPublishing: publishMutation.isPending,
    isDiscarding: discardMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
