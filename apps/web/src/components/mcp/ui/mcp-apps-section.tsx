// apps/web/src/components/mcp/ui/mcp-apps-section.tsx
'use client'

import { Plug } from 'lucide-react'
import { useState } from 'react'
import { useMcpServers } from '../hooks/use-mcp-servers'
import { AddMcpServerDialog } from './add-mcp-server-dialog'
import { McpAppCard } from './mcp-app-card'

interface McpAppsSectionProps {
  /** Marketplace browse (curated + add custom) is admin-only, matching the apps page. */
  isAdminOrOwner: boolean
  /** Search query from the apps page — filters by server name/description. */
  searchQuery?: string
}

/**
 * MCP block for Settings → Apps. Renders connected servers (alongside installed apps) and, for
 * admins, a browse strip of curated servers plus an "Add custom MCP server" card. Kept as one
 * self-contained component so the apps page only needs a single insertion point.
 */
export function McpAppsSection({ isAdminOrOwner, searchQuery = '' }: McpAppsSectionProps) {
  const { servers, refresh } = useMcpServers()
  const [addOpen, setAddOpen] = useState(false)

  const q = searchQuery.trim().toLowerCase()
  const matches = (s: (typeof servers)[number]) =>
    !q || s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false)

  // Connected (or org-owned custom) servers show in the installed strip; unconnected curated
  // servers are the browse catalog.
  const installed = servers.filter((s) => (s.connectionPresent || s.isCustom) && matches(s))
  const browse = servers.filter((s) => !s.connectionPresent && !s.isCustom && matches(s))

  if (!isAdminOrOwner && installed.length === 0) return null

  return (
    <div className='space-y-6'>
      {installed.length > 0 && (
        <div className='space-y-2'>
          <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
            <Plug className='size-4' />
            MCP servers
          </div>
          <div className='w-full @container'>
            <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
              {installed.map((server) => (
                <McpAppCard key={server.serverId} server={server} />
              ))}
            </div>
          </div>
        </div>
      )}

      {isAdminOrOwner && (
        <div className='space-y-2'>
          <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
            <Plug className='size-4' />
            Connect an MCP server
          </div>
          <div className='grid w-full gap-2 sm:grid-cols-2'>
            {browse.map((server) => (
              <McpAppCard key={server.serverId} server={server} />
            ))}
            <button
              type='button'
              onClick={() => setAddOpen(true)}
              className='rounded-2xl border border-dashed bg-primary-50 hover:bg-primary-50/50 flex flex-col items-center justify-center gap-1 p-3 text-sm text-muted-foreground'>
              <Plug className='size-4' />
              Add custom MCP server
            </button>
          </div>
          <AddMcpServerDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onConnected={() => void refresh()}
          />
        </div>
      )}
    </div>
  )
}
