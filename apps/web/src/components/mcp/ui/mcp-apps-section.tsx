// apps/web/src/components/mcp/ui/mcp-apps-section.tsx
'use client'

import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LayoutTemplate, Plug } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useMcpServers } from '../hooks/use-mcp-servers'
import { AddMcpServerDialog } from './add-mcp-server-dialog'
import { McpAppCard } from './mcp-app-card'
import { McpTemplateDialog } from './mcp-template-dialog'

/** Empty-state card matching the `AppListCard` shape, dashed to read as a placeholder. */
function ConnectPlaceholderCard({
  icon,
  title,
  subtitle,
  description,
  onClick,
}: {
  icon: ReactNode
  title: ReactNode
  subtitle: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='rounded-2xl border border-dashed bg-primary-50 hover:bg-primary-50/50 hover:outline-5 hover:outline-primary-50 flex flex-col p-3 gap-2 text-left'>
      <div className='flex flex-row items-start gap-2'>
        <div className='size-8 rounded-xl border border-dashed flex items-center justify-center'>
          {icon}
        </div>
        <div className='flex flex-col'>
          <div className='text-sm font-semibold'>{title}</div>
          <div className='text-xs text-muted-foreground'>{subtitle}</div>
        </div>
      </div>
      <div className='text-sm text-muted-foreground line-clamp-2'>{description}</div>
    </button>
  )
}

/** Connect menu behind the section-header button. */
function ConnectServerDropdown({
  align,
  onCustom,
  onTemplate,
  children,
}: {
  align: 'start' | 'end'
  onCustom: () => void
  onTemplate: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className='w-56'>
        <DropdownMenuItem onClick={onCustom}>
          <Plug />
          Connect custom server
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onTemplate} className='data-highlighted:bg-[#ffaa40]/10'>
          <LayoutTemplate className='text-[#ffaa40]' />
          <AnimatedGradientText>Connect from template</AnimatedGradientText>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface McpAppsSectionProps {
  /** Connecting a new server is admin-only, matching the apps page. */
  isAdminOrOwner: boolean
  /** Search query from the apps page — filters by server name/description. */
  searchQuery?: string
}

/**
 * MCP block for Settings → Apps. Renders connected servers (alongside installed apps) with a
 * header dropdown for admins to connect a new server — custom (paste dialog) or from the
 * template catalog. Kept as one self-contained component so the apps page only needs a single
 * insertion point.
 */
export function McpAppsSection({ isAdminOrOwner, searchQuery = '' }: McpAppsSectionProps) {
  const { servers, refresh } = useMcpServers()
  const [addOpen, setAddOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)

  const q = searchQuery.trim().toLowerCase()
  const matches = (s: (typeof servers)[number]) =>
    !q || s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false)

  // Connected (or org-owned custom) servers; unconnected curated servers are reachable through
  // the template dialog or the connect dialog's paste step.
  const installed = servers.filter((s) => (s.connectionPresent || s.isCustom) && matches(s))

  if (!isAdminOrOwner && installed.length === 0) return null

  return (
    <SettingsSection
      className='space-y-2'
      icon={Plug}
      title='MCP servers'
      action={
        isAdminOrOwner ? (
          <ConnectServerDropdown
            align='end'
            onCustom={() => setAddOpen(true)}
            onTemplate={() => setTemplateOpen(true)}>
            <Button variant='ghost' size='sm'>
              Connect server
            </Button>
          </ConnectServerDropdown>
        ) : undefined
      }>
      {(installed.length > 0 || isAdminOrOwner) && (
        <div className='w-full @container'>
          <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
            {installed.map((server) => (
              <McpAppCard
                key={server.serverId}
                server={server}
                canUninstall={isAdminOrOwner}
                onRemoved={() => void refresh()}
              />
            ))}
            {installed.length === 0 && isAdminOrOwner && (
              <>
                <ConnectPlaceholderCard
                  icon={<Plug className='size-4 text-muted-foreground' />}
                  title='Connect custom server'
                  subtitle='Custom server'
                  description='Paste a URL, config snippet, or install command.'
                  onClick={() => setAddOpen(true)}
                />
                <ConnectPlaceholderCard
                  icon={<LayoutTemplate className='size-4 text-[#ffaa40]' />}
                  title={<AnimatedGradientText>Connect from template</AnimatedGradientText>}
                  subtitle='Curated'
                  description='Pick a server from the curated template catalog.'
                  onClick={() => setTemplateOpen(true)}
                />
              </>
            )}
          </div>
        </div>
      )}
      {isAdminOrOwner && (
        <>
          <AddMcpServerDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onConnected={() => void refresh()}
          />
          <McpTemplateDialog
            open={templateOpen}
            onOpenChange={setTemplateOpen}
            onConnected={() => void refresh()}
          />
        </>
      )}
    </SettingsSection>
  )
}
