// apps/web/src/components/mcp/hooks/use-mcp-servers.ts
'use client'

import { useCallback } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

export type McpServerListEntry = RouterOutputs['mcp']['list'][number]

/**
 * Loads the org's MCP servers (curated + custom, connected + browsable) and exposes a
 * `refresh` that re-fetches `mcp.list` — one invalidation covers both this query and the
 * AppsContext projection (the builder catalog derives from the same query), so the
 * builder updates the same beat the settings UI does.
 */
export function useMcpServers() {
  const query = api.mcp.list.useQuery()
  const { refreshMcpServers } = useAppsContext()

  const refresh = useCallback(async () => {
    await refreshMcpServers()
  }, [refreshMcpServers])

  return {
    servers: query.data ?? [],
    isLoading: query.isLoading,
    refresh,
  }
}
