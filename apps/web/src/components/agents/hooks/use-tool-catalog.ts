// apps/web/src/components/agents/hooks/use-tool-catalog.ts
'use client'

import {
  type AgentSurface,
  buildCatalogTreeFromInstallations,
  type CatalogNode,
  filterCatalogToSurface,
} from '@auxx/lib/agents/client'
import { useMemo } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'

interface UseToolCatalogOptions {
  /**
   * Clamp the catalog to tools offered on this surface — set to `'chat'` for
   * chat-kind agents so the picker only shows what survives the runtime surface
   * filter. Absent ⇒ the full catalog (admin/internal view). See
   * plans/chat/v6/chat-tool-availability.md.
   */
  surface?: AgentSurface
}

/**
 * Returns the merged tool catalog tree, derived client-side from
 * `appInstallations` (which already includes the synthetic auxx row via
 * `installedAppsProvider`). Replaces the per-page
 * `api.agentToolset.list.useQuery()` round-trip. See
 * `plans/kopilot/agents/tools/project-builtin-auxx-into-installations.md`.
 */
export function useToolCatalog(options: UseToolCatalogOptions = {}): {
  catalog: CatalogNode[]
  isLoading: boolean
} {
  const { surface } = options
  const { appInstallations, isLoading } = useExtensionsContext()
  const catalog = useMemo(() => {
    const tree = buildCatalogTreeFromInstallations(appInstallations)
    return surface ? filterCatalogToSurface(tree, surface) : tree
  }, [appInstallations, surface])
  return { catalog, isLoading }
}
