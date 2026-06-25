// apps/web/src/components/connections/ui/mcp-reconnect-controller.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useMcpConnect } from '~/components/mcp/hooks/use-mcp-connect'
import { api } from '~/trpc/react'

interface McpReconnectControllerProps {
  /** The MCP server slug to (re)connect. */
  slug: string
  /** Refresh the connections grid after a successful connect. */
  onConnected: () => void
  /** Tear down this controller (connect resolved, or the field dialog was dismissed). */
  onClose: () => void
}

/**
 * Drives an MCP connect/reconnect for a single server from the unified connections grid. Loads the
 * server's full detail by slug, then fires the shared {@link useMcpConnect} flow once — the OAuth
 * popup, a direct connect, or the curated field dialog — reusing the exact decision the MCP
 * settings page uses, so the grid never mistakes an MCP OAuth connection for a bare API key.
 */
export function McpReconnectController({
  slug,
  onConnected,
  onClose,
}: McpReconnectControllerProps) {
  const { data: server } = api.mcp.getBySlug.useQuery({ slug })
  const mcp = useMcpConnect(
    server ?? null,
    () => {
      onConnected()
      onClose()
    },
    onClose
  )
  const started = useRef(false)

  // Fire the connect once the server detail resolves. OAuth/direct connects settle via their own
  // callbacks; a curated field dialog stays open until the user submits or dismisses it.
  useEffect(() => {
    if (server && !started.current) {
      started.current = true
      mcp.start()
    }
  }, [server, mcp])

  return mcp.Dialogs
}
