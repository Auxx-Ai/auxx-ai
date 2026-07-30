// apps/web/src/components/resources/hooks/use-file-refs.ts

import { useEffect, useMemo } from 'react'
import {
  type FileRefDetail,
  getFileRefStoreState,
  useHydratedFileRefs,
  useIsLoadingFileRefs,
} from '../store/file-ref-store'

interface UseFileRefsResult {
  /**
   * Resolved details in the input `refs` order. Refs that resolved to nothing
   * (deleted file, another org) are omitted — same as the rows
   * `file.resolveFileRefs` used to drop.
   */
  details: FileRefDetail[]
  /** Per-ref lookup: detail (found), null (not found), undefined (not loaded). */
  detailsByRef: Map<string, FileRefDetail | null | undefined>
  /** True while any ref is still unresolved. */
  isLoading: boolean
}

/**
 * Hook for requesting and subscribing to FILE ref display details.
 *
 * Replaces per-component `api.file.resolveFileRefs.useQuery` calls: refs are
 * queued in a shared store and `ResourceProvider` resolves the whole pending
 * set in one batched request, so a records table with a FILE column costs one
 * query per viewport instead of one per cell.
 *
 * @param refs - File refs (`"file:<id>"` / `"asset:<id>"`). Memoize this array.
 *
 * @example
 * const refs = useMemo(() => value.map((v) => v.ref), [value])
 * const { details, isLoading } = useFileRefs(refs)
 */
export function useFileRefs(refs: string[]): UseFileRefsResult {
  // Request hydration on mount/change. No flicker despite the effect running
  // after the first paint: `isLoading` reports "unresolved", not "in flight",
  // so the first render already shows the skeleton.
  useEffect(() => {
    if (refs.length === 0) return
    getFileRefStoreState().requestHydration(refs)
  }, [refs])

  const hydrated = useHydratedFileRefs(refs)
  const isLoading = useIsLoadingFileRefs(refs)

  const details = useMemo(
    () => hydrated.filter((detail): detail is FileRefDetail => !!detail),
    [hydrated]
  )

  const detailsByRef = useMemo(
    () => new Map(refs.map((ref, idx) => [ref, hydrated[idx]])),
    [refs, hydrated]
  )

  return { details, detailsByRef, isLoading }
}

export type { FileRefDetail }
