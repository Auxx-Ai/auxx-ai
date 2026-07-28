// apps/web/src/components/resources/hooks/use-record-resource-gate.ts
'use client'

import { useCallback } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { useResourceStore } from '../store/resource-store'

/**
 * Predicate behind the `recordResource` gate shared by drawer tabs, detail-view
 * main tabs and overview/sidebar cards: a surface that LISTS another
 * definition's records is hidden when the viewer can't read that definition.
 *
 * A coarse `permissionKey` cannot express this — `records.view` is true for
 * anyone holding any record access at all, so the gate has to be per-definition
 * (Layer 3, `canViewEntity`). Same rule {@link useViewableResources} applies to
 * the sidebar and pickers, applied to a single slug.
 *
 * Returns `true` for an undefined slug (the surface opts out of the gate) and
 * `false` for a slug the resource store can't resolve — the store hydrates the
 * whole catalog as one map, so an unresolved slug means the definition genuinely
 * doesn't exist for this org. Fail closed.
 *
 * @returns `(resourceSlug?: string) => boolean` — pass the slug the surface lists.
 */
export function useCanViewRecordResource(): (resourceSlug?: string) => boolean {
  const resourceMap = useResourceStore((s) => s.resourceMap)
  const { canViewEntity } = useAccess()

  return useCallback(
    (resourceSlug?: string) => {
      if (!resourceSlug) return true
      const defId = resourceMap.get(resourceSlug)?.entityDefinitionId
      return defId ? canViewEntity(defId) : false
    },
    [resourceMap, canViewEntity]
  )
}
