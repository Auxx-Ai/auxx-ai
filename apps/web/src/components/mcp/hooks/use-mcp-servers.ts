// apps/web/src/components/mcp/hooks/use-mcp-servers.ts
'use client'

import { useCallback } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

export type McpServerListEntry = RouterOutputs['mcp']['list'][number]

/**
 * Loads the org's MCP servers (curated + custom, connected + browsable) and exposes a
 * `refresh` that re-fetches `mcp.list` AND the ExtensionsContext projection so the builder
 * catalog updates the same beat the settings UI does.
 */
export function useMcpServers() {
  const query = api.mcp.list.useQuery()
  const utils = api.useUtils()
  const { refreshMcpServers } = useExtensionsContext()

  const refresh = useCallback(async () => {
    await Promise.all([utils.mcp.list.invalidate(), refreshMcpServers()])
  }, [utils, refreshMcpServers])

  return {
    servers: query.data ?? [],
    isLoading: query.isLoading,
    refresh,
  }
}
