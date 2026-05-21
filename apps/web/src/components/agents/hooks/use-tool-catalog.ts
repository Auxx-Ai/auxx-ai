// apps/web/src/components/agents/hooks/use-tool-catalog.ts
'use client'

import { buildCatalogTreeFromInstallations, type CatalogNode } from '@auxx/lib/agents/client'
import { useMemo } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'

/**
 * Returns the merged tool catalog tree, derived client-side from
 * `appInstallations` (which already includes the synthetic auxx row via
 * `installedAppsProvider`). Replaces the per-page
 * `api.agentToolset.list.useQuery()` round-trip. See
 * `plans/kopilot/agents/tools/project-builtin-auxx-into-installations.md`.
 */
export function useToolCatalog(): { catalog: CatalogNode[]; isLoading: boolean } {
  const { appInstallations, isLoading } = useExtensionsContext()
  const catalog = useMemo(
    () => buildCatalogTreeFromInstallations(appInstallations),
    [appInstallations]
  )
  return { catalog, isLoading }
}
