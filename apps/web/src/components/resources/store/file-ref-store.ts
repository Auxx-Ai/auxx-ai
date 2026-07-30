// apps/web/src/components/resources/store/file-ref-store.ts

import { useMemo } from 'react'
import { createHydrationStore, type HydrationStore } from '~/stores'

/**
 * Resolved display details for a single file ref ("file:<id>" / "asset:<id>").
 * Mirrors the `file.resolveFileRefs` row shape.
 */
export interface FileRefDetail {
  ref: string
  name: string
  mimeType: string | null
  size: number | null
}

/**
 * Zustand store for FILE ref hydration.
 *
 * Every FILE surface (table cells, read-only displays) requests refs here
 * instead of firing its own `file.resolveFileRefs` query. `ResourceProvider`
 * drains the pending set on a debounce and resolves the whole viewport in one
 * request — same shape as the relationship/actor stores.
 */
export const useFileRefStore = createHydrationStore<FileRefDetail>({
  name: 'file-ref',
  getKeyFromValue: (detail) => detail.ref,
})

/** Extended state type with convenience methods. */
export interface FileRefStoreState extends HydrationStore<FileRefDetail> {
  /** Queue refs for the next batch. Already-hydrated/in-flight refs are ignored. */
  requestHydration: (refs: string[]) => void
  /** Drain up to `max` pending refs into loadingIds and return the batch. */
  startBatch: (max: number) => string[]
  /**
   * Publish a resolved batch. `requestedRefs` is required so refs the server
   * dropped (deleted file, another org, malformed ref) get a null sentinel
   * instead of staying pending forever.
   */
  completeBatch: (details: FileRefDetail[], requestedRefs: string[]) => void
}

/** Get the file-ref store state with convenience methods. */
export function getFileRefStoreState(): FileRefStoreState {
  const state = useFileRefStore.getState()

  return {
    ...state,
    requestHydration: (refs: string[]) => {
      // Drop malformed refs up front — `resolveFileRefs` skips anything without
      // a `<type>:<id>` shape, so queueing them would only ever resolve to the
      // not-found sentinel after a wasted roundtrip.
      state.request(refs.filter((ref) => ref.includes(':')))
    },
    startBatch: (max: number) => {
      const refs = Array.from(state.pendingIds).slice(0, max)
      if (refs.length === 0) return []
      state.markLoading(refs)
      return refs
    },
    completeBatch: (details, requestedRefs) => {
      state.addItems(
        Object.fromEntries(details.map((detail) => [detail.ref, detail])),
        requestedRefs
      )
    },
  }
}

/**
 * Drop cached details for these refs so the next request refetches them.
 *
 * Batches are cached for the session (`staleTime: Infinity` in the provider),
 * so renames/deletes in the file manager must invalidate explicitly.
 */
export function invalidateFileRefs(refs: string[]): void {
  useFileRefStore.getState().invalidate(refs)
}

/**
 * Selector hook for hydrated file details.
 * Returns: FileRefDetail (found), null (not found/deleted), or undefined (not loaded).
 */
export function useHydratedFileRefs(refs: string[]): (FileRefDetail | null | undefined)[] {
  const dataMap = useFileRefStore((state) => state.dataMap)
  return useMemo(() => refs.map((ref) => dataMap[ref]), [refs, dataMap])
}

/**
 * Selector hook for whether any of `refs` is still unresolved.
 *
 * Deliberately "not in dataMap and not errored" rather than "in pendingIds or
 * loadingIds": the request is queued in an effect, so the first render after a
 * cell mounts has the ref in neither set and would otherwise report a false
 * `isLoading: false` and flash an empty cell before the skeleton.
 */
export function useIsLoadingFileRefs(refs: string[]): boolean {
  return useFileRefStore((state) =>
    refs.some((ref) => state.dataMap[ref] === undefined && !state.errorIds.has(ref))
  )
}
