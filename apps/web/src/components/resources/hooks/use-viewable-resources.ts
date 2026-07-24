// apps/web/src/components/resources/hooks/use-viewable-resources.ts

import type { CustomResource, Resource } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { useResourceStore } from '../store/resource-store'

interface UseViewableResourcesResult {
  /** Resources the current member can view (full list, filtered by the per-def read gate). */
  resources: Resource[]
  /** Viewable custom resources only. */
  customResources: CustomResource[]
  /** Loading state. */
  isLoading: boolean
}

/**
 * Enumeration-surface companion to {@link useResources}: the FULL resource list
 * filtered to the defs the current member can view (per-def read gate, Layer 2 ×
 * Layer 3). The store keeps hydrating the whole catalog — `getResourceById`
 * metadata lookups still resolve every def so a redacted relationship chip can
 * render a restricted def's icon/color/label. Only list-*enumerating* surfaces
 * (sidebar, global create, command palette, resource/field pickers) consume this
 * filtered view; metadata reads stay on the full map.
 *
 * OWNER/ADMIN bypass falls out of `canViewEntity`, so admins keep the full
 * catalog with no special case.
 */
export function useViewableResources(): UseViewableResourcesResult {
  const resources = useResourceStore((s) => s.resources)
  const customResources = useResourceStore((s) => s.customResources)
  const isQueryLoading = useResourceStore((s) => s.isLoading)
  const hasLoadedOnce = useResourceStore((s) => s.hasLoadedOnce)
  const { canViewEntity } = useAccess()

  // Per-def read gate. Phase 8 (§6.5): OR in a nonempty per-record instance-grant
  // set for the def once per-record CRM access ships — always empty today.
  const viewableResources = useMemo(
    () => resources.filter((r) => canViewEntity(r.entityDefinitionId)),
    [resources, canViewEntity]
  )
  const viewableCustomResources = useMemo(
    () => customResources.filter((r) => canViewEntity(r.entityDefinitionId)),
    [customResources, canViewEntity]
  )

  const isLoading = !hasLoadedOnce || isQueryLoading

  return {
    resources: viewableResources,
    customResources: viewableCustomResources,
    isLoading,
  }
}
