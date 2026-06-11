// apps/web/src/components/mcp/ui/mcp-apps-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Plug } from 'lucide-react'
import { useState } from 'react'
import { useMcpServers } from '../hooks/use-mcp-servers'
import { AddMcpServerDialog } from './add-mcp-server-dialog'
import { McpAppCard } from './mcp-app-card'

interface McpAppsSectionProps {
  /** Connecting a new server is admin-only, matching the apps page. */
  isAdminOrOwner: boolean
  /** Search query from the apps page — filters by server name/description. */
  searchQuery?: string
}

/**
 * MCP block for Settings → Apps. Renders connected servers (alongside installed apps) with a
 * header button for admins to connect a new server. Kept as one self-contained component so the
 * apps page only needs a single insertion point.
 */
export function McpAppsSection({ isAdminOrOwner, searchQuery = '' }: McpAppsSectionProps) {
  const { servers, refresh } = useMcpServers()
  const [addOpen, setAddOpen] = useState(false)

  const q = searchQuery.trim().toLowerCase()
  const matches = (s: (typeof servers)[number]) =>
    !q || s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false)

  // Connected (or org-owned custom) servers; unconnected curated servers are reachable through
  // the connect dialog's paste step, which pivots to the curated flow on a recognized URL.
  const installed = servers.filter((s) => (s.connectionPresent || s.isCustom) && matches(s))

  if (!isAdminOrOwner && installed.length === 0) return null

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
          <Plug className='size-4' />
          MCP servers
        </div>
        {isAdminOrOwner && (
          <Button variant='ghost' size='sm' onClick={() => setAddOpen(true)}>
            Connect server
          </Button>
        )}
      </div>
      {installed.length > 0 && (
        <div className='w-full @container'>
          <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
            {installed.map((server) => (
              <McpAppCard key={server.serverId} server={server} />
            ))}
          </div>
        </div>
      )}
      {isAdminOrOwner && (
        <AddMcpServerDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onConnected={() => void refresh()}
        />
      )}
    </div>
  )
}
