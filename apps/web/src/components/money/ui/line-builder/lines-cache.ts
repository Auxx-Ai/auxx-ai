// apps/web/src/components/money/ui/line-builder/lines-cache.ts
'use client'

import {
  type CreateLineInput,
  LINE_KINDS,
  type Line,
  type LineDocumentType,
  type LinePatch,
} from '@auxx/lib/accounting/documents/lines/client'
import type { LinesUpdatedEvent } from '@auxx/lib/realtime/client'
import { toastError } from '@auxx/ui/components/toast'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { useCallback, useMemo, useRef } from 'react'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { useRecordChannels } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/** The document a `lines.list` cache belongs to; `documentId` is the header's instance id. */
export interface LineDocument {
  documentType: LineDocumentType
  documentId: string
}

interface ListInput extends LineDocument {
  visitId?: string | null
}

/** Line ids with an optimistic write in flight, refcounted; realtime frames skip them. */
const pendingWrites = new Map<string, number>()

function markPending(ids: readonly string[]) {
  for (const id of ids) pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1)
}

/** Settle one write per id; returns the ids with no other write still in flight. */
function settlePending(ids: readonly string[]): Set<string> {
  const idle = new Set<string>()
  for (const id of ids) {
    const next = (pendingWrites.get(id) ?? 1) - 1
    if (next > 0) pendingWrites.set(id, next)
    else {
      pendingWrites.delete(id)
      idle.add(id)
    }
  }
  return idle
}

/** Same order the server returns: `sortOrder` (nulls last), then id. */
function bySortOrder(a: Line, b: Line): number {
  if (a.sortOrder !== b.sortOrder) {
    if (a.sortOrder === null) return 1
    if (b.sortOrder === null) return -1
    return a.sortOrder - b.sortOrder
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The server's list membership: a work order's lists split on `visitId`. */
function belongs(input: ListInput, line: Line): boolean {
  if (!LINE_KINDS[input.documentType].capabilities.visitScoped) return true
  return input.visitId ? line.visitId === input.visitId : !line.visitId
}

/** Replace lines by id, add new members, drop lines that left this list. */
export function upsertLines(lines: Line[], upserted: readonly Line[], input: ListInput): Line[] {
  const byId = new Map(lines.map((line) => [line.id, line]))
  for (const line of upserted) {
    if (belongs(input, line)) byId.set(line.id, line)
    else byId.delete(line.id)
  }
  return [...byId.values()].sort(bySortOrder)
}

/** Insert created lines after `anchorId` and renumber, as `createLines` does server-side. */
export function spliceLinesAfter(
  lines: Line[],
  anchorId: string,
  created: readonly Line[],
  input: ListInput
): Line[] {
  const members = created.filter((line) => belongs(input, line))
  const createdIds = new Set(members.map((line) => line.id))
  const rest = lines.filter((line) => !createdIds.has(line.id))
  const at = rest.findIndex((line) => line.id === anchorId)
  if (at === -1) return upsertLines(lines, created, input)
  const ordered = [...rest.slice(0, at + 1), ...members, ...rest.slice(at + 1)]
  return ordered.map((line, index) =>
    line.sortOrder === index ? line : { ...line, sortOrder: index }
  )
}

function listKey(doc: LineDocument) {
  return getQueryKey(api.lines.list, doc, 'query')
}

/** Rewrite every cached `lines.list` of this document (a work order has one per visit). */
function patchLists(
  queryClient: QueryClient,
  doc: LineDocument,
  fn: (lines: Line[], input: ListInput) => Line[]
) {
  for (const [key, data] of queryClient.getQueriesData<Line[]>({ queryKey: listKey(doc) })) {
    const input = (key[1] as { input?: ListInput } | undefined)?.input
    if (!data || !input) continue
    queryClient.setQueryData(key, fn(data, input))
  }
}

function findCached(queryClient: QueryClient, doc: LineDocument, ids: readonly string[]): Line[] {
  const wanted = new Set(ids)
  const found = new Map<string, Line>()
  for (const [, data] of queryClient.getQueriesData<Line[]>({ queryKey: listKey(doc) })) {
    for (const line of data ?? []) if (wanted.has(line.id)) found.set(line.id, line)
  }
  return [...found.values()]
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * The document's line writes through `api.lines.*`, each patching the `lines.list` cache
 * optimistically and rolling back with a `toastError` on failure.
 */
export function useLineWrites(doc: LineDocument) {
  const queryClient = useQueryClient()
  const { mutateAsync: createAsync } = api.lines.create.useMutation()
  const { mutateAsync: updateAsync } = api.lines.update.useMutation()
  const { mutateAsync: updateManyAsync } = api.lines.updateMany.useMutation()
  const { mutateAsync: reorderAsync } = api.lines.reorder.useMutation()
  const { mutateAsync: deleteAsync } = api.lines.delete.useMutation()
  const { documentType, documentId } = doc

  return useMemo(() => {
    const ref = { documentType, documentId }
    const upsert = (lines: readonly Line[]) =>
      patchLists(queryClient, ref, (cached, input) => upsertLines(cached, lines, input))

    /** Apply patches optimistically, write, then land the server rows no newer write shadows. */
    const writePatches = async (
      updates: Array<{ lineId: string; patch: LinePatch }>,
      send: () => Promise<Line[]>
    ): Promise<Line[]> => {
      const ids = [...new Set(updates.map((update) => update.lineId))]
      const previous = findCached(queryClient, ref, ids)
      markPending(ids)
      const patches = new Map<string, LinePatch>()
      for (const { lineId, patch } of updates) {
        patches.set(lineId, { ...patches.get(lineId), ...patch })
      }
      patchLists(queryClient, ref, (cached) =>
        cached.map((line) => {
          const patch = patches.get(line.id)
          return patch ? { ...line, ...patch } : line
        })
      )
      try {
        const lines = await send()
        const idle = settlePending(ids)
        upsert(lines.filter((line) => idle.has(line.id)))
        return lines
      } catch (error) {
        settlePending(ids)
        upsert(previous)
        throw error
      }
    }

    return {
      /** Create lines; appended, or spliced after `afterLineId`. Throws; the caller toasts. */
      create: async (lines: CreateLineInput[], afterLineId?: string): Promise<Line[]> => {
        const created = await createAsync({ ...ref, lines, afterLineId })
        patchLists(queryClient, ref, (cached, input) =>
          afterLineId
            ? spliceLinesAfter(cached, afterLineId, created, input)
            : upsertLines(cached, created, input)
        )
        return created
      },

      update: (lineId: string, patch: LinePatch): void => {
        if (Object.keys(patch).length === 0) return
        writePatches([{ lineId, patch }], async () => [
          await updateAsync({ ...ref, lineId, patch }),
        ]).catch((error: unknown) =>
          toastError({
            title: 'Error saving line',
            description: errorMessage(error, 'Could not save the line'),
          })
        )
      },

      /** Several lines' patches in one request. Throws; the caller toasts. */
      updateMany: async (updates: Array<{ lineId: string; patch: LinePatch }>) => {
        const nonEmpty = updates.filter((update) => Object.keys(update.patch).length > 0)
        if (nonEmpty.length === 0) return []
        return writePatches(nonEmpty, () => updateManyAsync({ ...ref, updates: nonEmpty }))
      },

      /** Persist a drag result; resolves `false` after toasting a failure. */
      reorder: async (orderedIds: string[]): Promise<boolean> => {
        markPending(orderedIds)
        try {
          const lines = await reorderAsync({ ...ref, orderedIds })
          const idle = settlePending(orderedIds)
          upsert(lines.filter((line) => idle.has(line.id)))
          return true
        } catch (error) {
          settlePending(orderedIds)
          void queryClient.invalidateQueries({ queryKey: listKey(ref) })
          toastError({
            title: 'Error reordering lines',
            description: errorMessage(error, 'Could not reorder the lines'),
          })
          return false
        }
      },

      /** Drop lines now; the server deletes and recomputes the header totals. */
      remove: (ids: string[]): void => {
        const previous = findCached(queryClient, ref, ids)
        const removed = new Set(ids)
        markPending(ids)
        patchLists(queryClient, ref, (cached) => cached.filter((line) => !removed.has(line.id)))
        deleteAsync({ ...ref, ids })
          .then(() => settlePending(ids))
          .catch((error: unknown) => {
            settlePending(ids)
            upsert(previous)
            toastError({
              title: 'Error deleting line',
              description: errorMessage(error, 'Could not delete the line'),
            })
          })
      },
    }
  }, [
    queryClient,
    documentType,
    documentId,
    createAsync,
    updateAsync,
    updateManyAsync,
    reorderAsync,
    deleteAsync,
  ])
}

/**
 * Apply `lines:updated` for one document to its `lines.list` caches, skipping lines with an
 * optimistic write in flight. The oversize fallback and a resubscribe refetch instead.
 */
export function useLinesSync(documentType: LineDocumentType, documentId: string) {
  const queryClient = useQueryClient()
  const parentDefId = useResourceStore(
    (state) => state.resourceMap.get(LINE_KINDS[documentType].parentEntityType)?.id
  )
  const defIds = useMemo(() => (parentDefId ? [parentDefId] : []), [parentDefId])
  // The first subscribe lands with (or before) the initial fetch; only a resubscribe misses frames.
  const subscribedOnceRef = useRef(false)

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: listKey({ documentType, documentId }) })
  }, [queryClient, documentType, documentId])

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event === 'records:invalidated') {
        const { entityDefinitionId } = payload as { entityDefinitionId?: string }
        if (entityDefinitionId === parentDefId) invalidate()
        return
      }
      if (event !== 'lines:updated') return
      const data = payload as LinesUpdatedEvent['data']
      if (data.documentType !== documentType || data.documentId !== documentId) return
      const upserted = data.upserted.filter((line) => !pendingWrites.has(line.id))
      const deleted = new Set(data.deleted.filter((id) => !pendingWrites.has(id)))
      if (upserted.length === 0 && deleted.size === 0) return
      patchLists(queryClient, { documentType, documentId }, (cached, input) =>
        upsertLines(
          cached.filter((line) => !deleted.has(line.id)),
          upserted,
          input
        )
      )
    },
    [queryClient, documentType, documentId, parentDefId, invalidate]
  )

  const onDefSubscribed = useCallback(() => {
    if (subscribedOnceRef.current) invalidate()
    subscribedOnceRef.current = true
  }, [invalidate])

  useRecordChannels(defIds, { onEvent, onDefSubscribed })
}
