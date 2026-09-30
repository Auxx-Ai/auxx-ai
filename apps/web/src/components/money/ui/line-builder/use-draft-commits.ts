// apps/web/src/components/money/ui/line-builder/use-draft-commits.ts
'use client'

import type { Line, LineKind } from '@auxx/lib/accounting/documents/lines/client'
import { toastError } from '@auxx/ui/components/toast'
import { type RefObject, useCallback, useRef } from 'react'
import type { DraftLine } from './line-rows'
import { diffLineValues, draftCreateInput, type LinePatch, toLinePatch } from './line-values'
import type { useLineWrites } from './lines-cache'

/** `lines.create` takes at most this many per request. */
const CREATE_CHUNK = 50

type LineWrites = ReturnType<typeof useLineWrites>

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

interface DraftCommitsOptions {
  kind: LineKind
  visitId: string | undefined
  /** False until the line entity's def resolves; no draft is created before then. */
  enabled: boolean
  writes: LineWrites
  draftsRef: RefObject<DraftLine[]>
  /** The builder's single draft-state writer. */
  mutateDrafts: (fn: (prev: DraftLine[]) => DraftLine[]) => void
  initialDraftIdsRef: RefObject<Set<string>>
  /** The persisted rows in display order, for a bundle's splice anchor. */
  displayIdsRef: RefObject<string[]>
}

/**
 * A draft's life from first commit to line (plans/entity/domain-tables/01-lines-module.md §3):
 * create on the first commit, flush edits made in flight as one `updateMany`, and send any
 * commit that reaches the draft after it became a line to that line.
 */
export function useDraftCommits({
  kind,
  visitId,
  enabled,
  writes,
  draftsRef,
  mutateDrafts,
  initialDraftIdsRef,
  displayIdsRef,
}: DraftCommitsOptions) {
  // Ref-guarded so a synchronous double-commit never races two creates for one draft.
  const creatingDraftIdsRef = useRef<Set<string>>(new Set())
  // draftId -> the line its create produced. The swap unmounts the draft row, and a cell's
  // blur on that removal (or a prefill) can still commit to the draft id afterwards.
  const draftLineIdsRef = useRef<Map<string, string>>(new Map())

  /** Draft delete (trash icon) — local splice, no network. */
  const deleteDraft = useCallback(
    (draftId: string) => {
      creatingDraftIdsRef.current.delete(draftId)
      initialDraftIdsRef.current.delete(draftId)
      mutateDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
    },
    [mutateDrafts, initialDraftIdsRef]
  )

  /** What changed on each draft while its create was in flight, for one `updateMany`. */
  const draftEditsSince = useCallback(
    (created: Array<{ lineId: string; snapshot: DraftLine; draftId: string }>) =>
      created.flatMap(({ lineId, snapshot, draftId }) => {
        const latest = draftsRef.current.find((d) => d.draftId === draftId) ?? snapshot
        const patch = toLinePatch(diffLineValues(snapshot, latest), kind)
        return Object.keys(patch).length > 0 ? [{ lineId, patch }] : []
      }),
    [kind, draftsRef]
  )

  /**
   * Fire the draft's create with every accumulated value plus `overrides`. A second commit
   * while it is in flight only accumulates; the completion flushes the difference.
   */
  const createDraft = useCallback(
    async (draftId: string, overrides: LinePatch = {}) => {
      const lineId = draftLineIdsRef.current.get(draftId)
      if (lineId) {
        writes.update(lineId, toLinePatch(overrides, kind))
        return
      }
      // The first real edit demotes the other placeholders to ordinary drafts.
      initialDraftIdsRef.current.clear()
      const accumulate = () =>
        mutateDrafts((prev) =>
          prev.map((d) => (d.draftId === draftId ? { ...d, ...overrides } : d))
        )
      if (creatingDraftIdsRef.current.has(draftId)) {
        accumulate()
        return
      }
      // A purchase order line has no identity without its part: accumulate until one is picked.
      if (kind.capabilities.draftRequiresPart) {
        const pending = draftsRef.current.find((d) => d.draftId === draftId)
        const partRecordId = overrides.partRecordId ?? pending?.partRecordId ?? null
        if (!partRecordId) {
          accumulate()
          return
        }
      }

      const currentDraft = draftsRef.current.find((d) => d.draftId === draftId)
      if (!currentDraft || !enabled) return
      const snapshot: DraftLine = { ...currentDraft, ...overrides, creating: true }

      creatingDraftIdsRef.current.add(draftId)
      mutateDrafts((prev) => prev.map((d) => (d.draftId === draftId ? snapshot : d)))

      let created: Line | undefined
      try {
        ;[created] = await writes.create([draftCreateInput(snapshot, kind, visitId)])
        if (!created) throw new Error('The line was not created')
      } catch (error) {
        creatingDraftIdsRef.current.delete(draftId)
        mutateDrafts((prev) =>
          prev.map((d) => (d.draftId === draftId ? { ...d, creating: false } : d))
        )
        toastError({
          title: 'Error adding line',
          description: errorMessage(error, 'Could not add the line'),
        })
        return
      }

      const updates = draftEditsSince([{ lineId: created.id, snapshot, draftId }])
      creatingDraftIdsRef.current.delete(draftId)
      draftLineIdsRef.current.set(draftId, created.id)
      mutateDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
      if (updates.length > 0) {
        await writes.updateMany(updates).catch((error: unknown) =>
          toastError({
            title: 'Error saving line',
            description: errorMessage(error, 'Could not save the line'),
          })
        )
      }
    },
    [enabled, kind, visitId, mutateDrafts, writes, draftEditsSince, draftsRef, initialDraftIdsRef]
  )

  /**
   * Land the supplier price prefill, which resolves on its own clock. Not `createDraft`:
   * that would re-arm placeholder cleanup and trip the part guard (plans/purchasing/05 §5.2).
   */
  const applyPrefillPatch = useCallback(
    async (draftId: string, patch: LinePatch) => {
      const lineId = draftLineIdsRef.current.get(draftId)
      if (!lineId) {
        mutateDrafts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, ...patch } : d)))
        return
      }
      const changed = toLinePatch(patch, kind)
      if (Object.keys(changed).length === 0) return
      try {
        await writes.updateMany([{ lineId, patch: changed }])
      } catch (error) {
        toastError({
          title: 'Error applying the supplier price',
          description: errorMessage(error, 'Could not apply the supplier price'),
        })
      }
    },
    [mutateDrafts, writes, kind]
  )

  /**
   * Materialize a staged bundle of pre-filled drafts in one create (plan 31 §D), spliced
   * after the anchor row when there is one. On error every bundle draft resets to editable.
   */
  const createDrafts = useCallback(
    async (bundleDrafts: DraftLine[]) => {
      if (!enabled || bundleDrafts.length === 0) return
      const draftIds = new Set(bundleDrafts.map((d) => d.draftId))
      for (const draftId of draftIds) {
        initialDraftIdsRef.current.delete(draftId)
        creatingDraftIdsRef.current.add(draftId)
      }

      // Snapshot each draft's current values while marking them all `creating` in one write.
      const snapshots = new Map<string, DraftLine>()
      mutateDrafts((prev) =>
        prev.map((d) => {
          if (!draftIds.has(d.draftId)) return d
          const snapshot: DraftLine = { ...d, creating: true }
          snapshots.set(d.draftId, snapshot)
          return snapshot
        })
      )
      const ordered = bundleDrafts.flatMap((d) => {
        const snapshot = snapshots.get(d.draftId)
        return snapshot ? [snapshot] : []
      })
      if (ordered.length === 0) return

      const anchorLineId = ordered[0]?.anchorLineId
      let afterLineId =
        anchorLineId && displayIdsRef.current.includes(anchorLineId) ? anchorLineId : undefined
      const created: Array<{ lineId: string; snapshot: DraftLine; draftId: string }> = []
      try {
        for (let start = 0; start < ordered.length; start += CREATE_CHUNK) {
          const chunk = ordered.slice(start, start + CREATE_CHUNK)
          const lines = await writes.create(
            chunk.map((draft) => draftCreateInput(draft, kind, visitId)),
            afterLineId
          )
          lines.forEach((line, index) => {
            const snapshot = chunk[index]
            if (snapshot) created.push({ lineId: line.id, snapshot, draftId: snapshot.draftId })
          })
          if (afterLineId) afterLineId = lines.at(-1)?.id ?? afterLineId
        }
      } catch (error) {
        const done = new Set(created.map((entry) => entry.draftId))
        for (const entry of created) draftLineIdsRef.current.set(entry.draftId, entry.lineId)
        for (const draftId of draftIds) creatingDraftIdsRef.current.delete(draftId)
        mutateDrafts((prev) =>
          prev
            .filter((d) => !done.has(d.draftId))
            .map((d) => (draftIds.has(d.draftId) ? { ...d, creating: false } : d))
        )
        toastError({
          title: 'Error adding lines',
          description: errorMessage(error, 'Could not add the lines'),
        })
        return
      }

      const updates = draftEditsSince(created)
      for (const entry of created) draftLineIdsRef.current.set(entry.draftId, entry.lineId)
      for (const draftId of draftIds) creatingDraftIdsRef.current.delete(draftId)
      mutateDrafts((prev) => prev.filter((d) => !draftIds.has(d.draftId)))
      if (updates.length > 0) {
        await writes.updateMany(updates).catch((error: unknown) =>
          toastError({
            title: 'Error saving lines',
            description: errorMessage(error, 'Could not save the lines'),
          })
        )
      }
    },
    [
      enabled,
      kind,
      visitId,
      mutateDrafts,
      writes,
      draftEditsSince,
      initialDraftIdsRef,
      displayIdsRef,
    ]
  )

  return { createDraft, createDrafts, applyPrefillPatch, deleteDraft }
}
