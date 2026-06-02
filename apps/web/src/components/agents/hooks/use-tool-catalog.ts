// apps/web/src/components/agents/hooks/use-tool-catalog.ts
'use client'

import {
  buildCatalogTreeFromInstallations,
  type CatalogNode,
  filterCatalogToChatSafe,
} from '@auxx/lib/agents/client'
import { useMemo } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'

interface UseToolCatalogOptions {
  /**
   * Clamp the catalog to chat-safe tools only — set for chat-kind agents so
   * the picker can't surface tools that aren't safe for an anonymous visitor.
   * See plans/chat/v5 phase-2 §5.
   */
  chatSafeOnly?: boolean
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
  const { chatSafeOnly = false } = options
  const { appInstallations, isLoading } = useExtensionsContext()
  const catalog = useMemo(() => {
    const tree = buildCatalogTreeFromInstallations(appInstallations)
    return chatSafeOnly ? filterCatalogToChatSafe(tree) : tree
  }, [appInstallations, chatSafeOnly])
  return { catalog, isLoading }
}
