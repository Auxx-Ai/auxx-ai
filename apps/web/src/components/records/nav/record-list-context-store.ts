// apps/web/src/components/records/nav/record-list-context-store.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { create } from 'zustand'
import { createListKey } from '~/components/resources/store/record-store'

/**
 * The value that identifies "the list I am inside".
 *
 * It is exactly what `useRecordList` consumes, which is the point: feeding this
 * back in on the detail page produces the same `listKey` the table produced, so
 * the ids come from the record store's list cache with no request at all.
 *
 * `filters` is the FULLY MERGED set — baseline (the records search bar) + view
 * filters + personal overlays + session filters. A saved `viewId` alone is not
 * the list; reconstructing from it silently walks a different one.
 */
export interface RecordListDescriptor {
  entityDefinitionId: string
  filters: ConditionGroup[]
  /**
   * The search bar's free text, when the list was searched. A separate axis from
   * `filters` (plan decision 0.3), so it has to be carried separately or
   * `loadMore` pages the UNsearched list and prev/next walks off into records
   * the user never saw.
   */
  search?: string
  sorting: Array<{ id: string; desc: boolean }>
  /** `entity-${entityDefinitionId}` for the records table; embedded surfaces differ. */
  tableId: string
  /** Saved view backing this list, when there is one. Drives the `?list=` token. */
  viewId: string | null
  /** Human label for the popover trigger — "My hot leads", "Tickets of Acme Corp". */
  label: string
}

export interface RecordListContextEntry {
  descriptor: RecordListDescriptor
  /** The ids the source surface had loaded at capture time. */
  ids: string[]
  capturedAt: number
}

interface RecordListContextState {
  /**
   * Keyed by `entityDefinitionId` — opening a ticket from the contacts table
   * must not inherit the contacts descriptor.
   */
  byDefinitionId: Record<string, RecordListContextEntry>
  capture: (descriptor: RecordListDescriptor, ids: string[]) => void
  clear: () => void
}

/**
 * Identity of a descriptor for change detection. `createListKey` already hashes
 * (def, filters, sorting) — the tuple that decides the QUERY — and `viewId` +
 * `label` cover the presentation bits that do not affect it.
 */
function descriptorKey(descriptor: RecordListDescriptor): string {
  const listKey = createListKey(
    descriptor.entityDefinitionId,
    descriptor.filters,
    descriptor.sorting,
    descriptor.search
  )
  return `${listKey}|${descriptor.viewId ?? ''}|${descriptor.label}`
}

/** Whether `next` is `prev` truncated — i.e. it carries nothing new. */
function isPrefixOf(next: string[], prev: string[]): boolean {
  if (next.length > prev.length) return false
  return next.every((id, i) => prev[i] === id)
}

export const useRecordListContextStore = create<RecordListContextState>((set, get) => ({
  byDefinitionId: {},

  capture: (descriptor, ids) => {
    const existing = get().byDefinitionId[descriptor.entityDefinitionId]
    // The publisher runs on every table render. Writing an identical entry would
    // re-notify every subscriber for nothing, so bail unless something moved:
    // the query/label changed, or the surface loaded rows we do not have yet.
    if (
      existing &&
      descriptorKey(existing.descriptor) === descriptorKey(descriptor) &&
      isPrefixOf(ids, existing.ids)
    ) {
      return
    }
    set((state) => ({
      byDefinitionId: {
        ...state.byDefinitionId,
        [descriptor.entityDefinitionId]: { descriptor, ids, capturedAt: Date.now() },
      },
    }))
  },

  clear: () => set({ byDefinitionId: {} }),
}))

/**
 * Drop every captured list context.
 *
 * Called alongside `clearResourceCaches()` on logout and org switch. Stale
 * entries from another ORG are inert (EntityDefinition ids are per-org rows and
 * would never resolve), but a different USER on the same browser and org would
 * otherwise inherit the previous user's personal filter overlays.
 */
export function clearRecordListContext(): void {
  useRecordListContextStore.getState().clear()
}

/** Non-reactive read, for callbacks and effects. */
export function getRecordListContext(
  entityDefinitionId: string | undefined
): RecordListContextEntry | undefined {
  if (!entityDefinitionId) return undefined
  return useRecordListContextStore.getState().byDefinitionId[entityDefinitionId]
}

/** Reactive read for a single definition. */
export function useRecordListContext(
  entityDefinitionId: string | undefined
): RecordListContextEntry | undefined {
  return useRecordListContextStore((s) =>
    entityDefinitionId ? s.byDefinitionId[entityDefinitionId] : undefined
  )
}
