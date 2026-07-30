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
  const { hasDefPresence } = useAccess()

  // **The front door** (plan v3/03 §6.1, P5) — this is the OR the seam comment
  // that stood here promised. The filter is `hasDefPresence`, i.e.
  // `canViewEntity(def) || grantedDefIds[def]`, so a member who was shared a
  // single record keeps the definition's nav entry and can reach the row.
  //
  // Clicking through lands on a table scoped by §5.1 arm 3 — one shared contact
  // means a one-row table with `total: 1`. The def-scoped affordances on that
  // page (New, import, export-all, bulk, view management) key off the DEF level,
  // which is honestly `none` for such a member, so they hide with zero new code;
  // row-scoped affordances key off the `_access` stamp.
  //
  // This reverses plan 08 §4.7 ("deep-link only, no nav re-entry"), deliberately:
  // the support ticket that lock generates ("I shared it and they say they can't
  // find it") costs more than this one-line widening at a seam that was already
  // waiting for it.
  const viewableResources = useMemo(
    () => resources.filter((r) => hasDefPresence(r.entityDefinitionId)),
    [resources, hasDefPresence]
  )
  const viewableCustomResources = useMemo(
    () => customResources.filter((r) => hasDefPresence(r.entityDefinitionId)),
    [customResources, hasDefPresence]
  )

  const isLoading = !hasLoadedOnce || isQueryLoading

  return {
    resources: viewableResources,
    customResources: viewableCustomResources,
    isLoading,
  }
}
