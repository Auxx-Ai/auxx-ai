'use client'
import type { ChatWidget, IntegrationSyncStage, IntegrationSyncStatus } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Switch } from '@auxx/ui/components/switch'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import {
  Mail,
  MessageSquare, // Added for Chat Widget
  MoreHorizontal,
  Pencil,
  Phone,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
// ~/app/(protected)/app/settings/integrations/_components/integration-table.tsx
import type React from 'react'
import {
  getIntegrationStatus,
  IntegrationStatusIndicator,
} from '~/components/global/integration-status-indicator'
import { Tooltip } from '~/components/global/tooltip'
import type { InboxItem } from '~/components/threads/hooks'
import { FacebookIcon, GoogleIcon, InstagramIcon, OutlookIcon } from '~/constants/icons'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

// Define type for integration (simplified, adjust based on actual API response)
interface DisplayIntegration {
  id: string
  provider: string
  enabled: boolean
  updatedAt: string
  lastSyncedAt?: string | null
  name?: string | null // Name from Integration model
  identifier?: string | null // Derived identifier
  inboxId?: string | null
  widgetSettings?: ChatWidget | null // Include potential widget settings
  metadata?: any // For auth error tracking (legacy)
  email?: string | null
  // Auth status fields from database
  authStatus?: string
  lastAuthError?: string | null
  lastAuthErrorAt?: Date | null
  requiresReauth?: boolean
  lastSuccessfulSync?: Date | null
  // Sync state fields from database
  syncStatus?: IntegrationSyncStatus | null
  syncStage?: IntegrationSyncStage | null
  syncStageStartedAt?: Date | null
  throttleRetryAfter?: Date | null
}
interface IntegrationTableProps {
  integrations: DisplayIntegration[]
  inboxes: InboxItem[]
}
/**
 * Get provider icon based on provider type
 */
export const getIntegrationProviderIcon = (provider: string, className?: string) => {
  const iconMap: Record<string, React.ComponentType<SVGProps<SVGSVGElement>>> = {
    google: GoogleIcon,
    outlook: OutlookIcon,
    facebook: FacebookIcon,
    instagram: InstagramIcon,
    openphone: Phone,
    chat: MessageSquare,
  }
  const IconComponent = iconMap[provider.toLowerCase()]
  if (IconComponent) {
    return <IconComponent className={cn('size-5', className)} />
  } else {
    return <Mail className={cn('size-5 text-gray-500', className)} />
  }
}
/**
 * Get provider display name
 */
const getProviderName = (provider: string) => {
  switch (provider.toLowerCase()) {
    case 'google':
      return 'Gmail'
    case 'outlook':
      return 'Outlook'
    case 'facebook':
      return 'Facebook'
    case 'instagram':
      return 'Instagram'
    case 'openphone':
      return 'OpenPhone'
    case 'chat':
      return 'Chat Widget'
    default:
      return provider
  }
}
/**
 * Checks if a click event originated from an interactive element
 * @param event The React mouse event
 * @returns true if click was on an interactive element, false otherwise
 */
const isClickOnInteractiveElement = (event: React.MouseEvent): boolean => {
  // Get the clicked element
  const target = event.target as HTMLElement
  console.log(target)
  // Check if the element or any of its parents have the data-clickable attribute
  const isClickable = (element: HTMLElement | null): boolean => {
    if (!element) return false
    if (element.dataset.clickable === 'true') return true
    if (element.parentElement) return isClickable(element.parentElement)
    return false
  }
  return isClickable(target)
}
/**
 * IntegrationTable component
 * Displays a table of integrations with actions
 */
export default function IntegrationTable({ integrations, inboxes }: IntegrationTableProps) {
  const router = useRouter()
  const posthog = useAnalytics()
  const utils = api.useUtils()
  const toggleIntegration = api.channel.toggle.useMutation({
    onSuccess: () => {
      utils.channel.list.invalidate()
      toastSuccess({ title: 'Integration updated', description: 'Status updated successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Error updating integration status', description: error.message })
    },
  })
  const disconnectIntegration = api.channel.disconnect.useMutation({
    onSuccess: () => {
      utils.channel.list.invalidate()
      utils.thread.getCounts.invalidate()
      toastSuccess({ title: 'Integration disconnected' })
    },
    onError: (error) => {
      toastError({ title: 'Error disconnecting integration', description: error.message })
    },
  })
  const syncMessages = api.channel.syncMessages.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Sync started' })
    },
    onError: (error) => {
      toastError({ title: 'Error starting sync', description: error.message })
    },
  })
  /** Find connected inbox for an integration using its inboxId */
  const getConnectedInbox = (integration: DisplayIntegration) => {
    if (!integration.inboxId) return undefined
    return inboxes?.find((inbox) => inbox.id === integration.inboxId)
  }
  // Handle toggle integration status
  const handleToggle = (id: string, currentState: boolean) => {
    const provider = integrations.find((i) => i.id === id)?.provider ?? 'unknown'
    posthog?.capture('integration_toggled', { provider, enabled: !currentState })
    toggleIntegration.mutate({ integrationId: id, enabled: !currentState })
  }
  // Handle edit integration
  const handleEdit = (event: React.MouseEvent, id: string) => {
    if (!isClickOnInteractiveElement(event)) {
      router.push(`/app/settings/channels/${id}`)
    }
  }
  // Handle disconnect integration
  const handleDisconnect = (id: string) => {
    if (
      window.confirm(
        'Are you sure you want to disconnect this integration? This action cannot be undone.'
      )
    ) {
      const provider = integrations.find((i) => i.id === id)?.provider ?? 'unknown'
      posthog?.capture('integration_disconnected', { provider, integration_id: id })
      disconnectIntegration.mutate({ integrationId: id })
    }
  }
  // Handle sync messages
  const handleSync = (id: string) => {
    syncMessages.mutate({
      integrationId: id,
      days: 7, // Default to 7 days
    })
  }
  return (
    <div className='overflow-auto flex-1 h-full'>
      <table className='w-full caption-bottom text-sm'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-[50px]'>Type</TableHead>
            <TableHead>Name / ID</TableHead>
            <TableHead>Routing To</TableHead>
            <TableHead>Connected</TableHead>
            <TableHead className='w-[120px]'>Status</TableHead>
            <TableHead className='w-[80px]'>Enabled</TableHead>
            <TableHead className='text-right'>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {integrations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className='h-24 text-center'>
                No integrations found.
              </TableCell>
            </TableRow>
          ) : (
            integrations.map((integration) => {
              const connectedInbox = getConnectedInbox(integration)
              const providerDisplayName = getProviderName(integration.provider)
              const displayName =
                integration.name ||
                (integration.provider === 'chat'
                  ? integration.widgetSettings?.title
                  : providerDisplayName) ||
                'Unnamed Integration'
              // Determine identifier: Use derived identifier, fallback to widget name/title or 'Unknown'
              const displayIdentifier =
                integration.identifier ||
                (integration.provider === 'chat' ? integration.widgetSettings?.name : '') ||
                'Unknown'
              const isForwarding =
                integration.provider === 'email' &&
                (integration.metadata as any)?.channelType === 'forwarding-address'

              return (
                <TableRow
                  key={integration.id}
                  className='cursor-pointer hover:bg-muted/50'
                  onClick={(e: React.MouseEvent) => handleEdit(e, integration.id)}>
                  <TableCell>
                    <Tooltip content={providerDisplayName}>
                      {getIntegrationProviderIcon(integration.provider)}
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <div className='font-medium'>{displayName}</div>
                    <div
                      className='text-sm text-muted-foreground truncate line-clamp-1'
                      title={integration.identifier || 'Unknown'}>
                      {integration.identifier || 'Unknown'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {connectedInbox ? (
                      <Badge variant='pill' size='sm' className='truncate'>
                        {connectedInbox.name}
                      </Badge>
                    ) : (
                      <Badge
                        variant='pill'
                        size='sm'
                        className='bg-yellow-50 text-yellow-800 inline-flex truncate'>
                        Not connected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {integration.updatedAt && (
                      <span className='text-sm text-muted-foreground'>
                        {format(new Date(integration.updatedAt), 'MMM d, yyyy')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <IntegrationStatusIndicator
                      status={getIntegrationStatus({
                        enabled: integration.enabled,
                        requiresReauth: integration.requiresReauth || false,
                        lastAuthError: integration.lastAuthError,
                        lastSyncedAt: integration.lastSyncedAt
                          ? new Date(integration.lastSyncedAt)
                          : undefined,
                        syncStatus: integration.syncStatus,
                      })}
                      syncStage={integration.syncStage}
                      lastSyncAt={
                        integration.lastSyncedAt ? new Date(integration.lastSyncedAt) : undefined
                      }
                      lastError={integration.lastAuthError}
                      size='sm'
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      data-clickable='true'
                      size='sm'
                      checked={integration.enabled}
                      onCheckedChange={() => handleToggle(integration.id, integration.enabled)}
                    />
                  </TableCell>
                  <TableCell className='text-right' data-clickable='true'>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='icon'>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleEdit(integration.id)}>
                          <Pencil />
                          Edit Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleSync(integration.id)}
                          disabled={integration.provider === 'chat' || isForwarding}>
                          <RefreshCw />
                          Sync Messages
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => handleDisconnect(integration.id)}
                          disabled={isForwarding}>
                          <Trash2 />
                          Disconnect
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </table>
    </div>
  )
}
