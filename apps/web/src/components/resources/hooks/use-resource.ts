// apps/web/src/components/resources/hooks/use-resource.ts

import type { Resource } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useResourceStore } from '../store/resource-store'
import { composeEffectiveFields } from './use-resource-fields'

interface UseResourceResult {
  /** The resource (or undefined if not found) */
  resource: Resource | undefined
  /** Loading state */
  isLoading: boolean
}

/**
 * Hook for getting a single resource by ID
 * @param resourceId - Can be entityDefinitionId, apiSlug, or systemType (e.g. "contacts")
 *
 * The returned resource's `fields` are EFFECTIVE fields (server + optimistic
 * overlay via `composeEffectiveFields`), not the raw hydration snapshot. The
 * snapshot in `resourceMap` is written once per `resource.list` fetch and never
 * touched by field mutations, so any surface rendering `resource.fields` raw
 * shows pre-mutation state — and a surface that writes a full option list back
 * from that stale read deletes what it couldn't see. Everything else on the
 * resource (display config, ordering, flags) still comes from the snapshot.
 */
export function useResource(resourceId: string | null | undefined): UseResourceResult {
  // Subscribe to stable store slices and compose in useMemo — a selector that
  // builds a fresh object every call fails zustand's Object.is check and
  // re-renders on every store write.
  const snapshot = useResourceStore((s) => (resourceId ? s.resourceMap.get(resourceId) : undefined))
  const fieldMap = useResourceStore((s) => s.fieldMap)
  const optimisticDeletedFields = useResourceStore((s) => s.optimisticDeletedFields)
  const optimisticNewFields = useResourceStore((s) => s.optimisticNewFields)
  const isQueryLoading = useResourceStore((s) => s.isLoading)
  const hasLoadedOnce = useResourceStore((s) => s.hasLoadedOnce)

  const resource = useMemo(() => {
    if (!snapshot) return undefined
    return {
      ...snapshot,
      fields: composeEffectiveFields(
        snapshot,
        fieldMap,
        optimisticDeletedFields,
        optimisticNewFields
      ),
    }
  }, [snapshot, fieldMap, optimisticDeletedFields, optimisticNewFields])

  // If we haven't loaded resources yet, we're loading
  // Or if the query is currently loading, we're loading
  const isLoading = !hasLoadedOnce || isQueryLoading

  return { resource, isLoading }
}
