// apps/web/src/components/data-connectors/ui/connector-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { Cable, FileText, MoreVertical, Pause, Play, RefreshCw, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useConnectorMutations } from '../hooks/use-connector-mutations'
import { asConnectorStatus, CONNECTOR_STATUS_META } from './connector-status'

/** A connector row as returned by `dataConnector.list`. */
export interface ConnectorCardData {
  id: string
  name: string
  type: string
  status: string
  itemCount: number
  lastSyncedAt: Date | string | null
  error: string | null
}

interface ConnectorCardProps {
  connector: ConnectorCardData
  /** Per-stream counts keyed by connector id, if the parent has them. */
  streamCount?: number
}

/** Default icon for connectors without a brand (generic-rest, unknown types). */
const DEFAULT_CONNECTOR_ICON_ID = 'plug'

/** Derive a display icon id from the connector type (`app:<slug>` → brand). */
function iconIdForType(type: string): string {
  if (type.startsWith('app:')) return `brand:${type.slice('app:'.length)}`
  return DEFAULT_CONNECTOR_ICON_ID
}

/**
 * A single connector card in the list grid. Status dot, last-synced, item count,
 * per-stream count, and an Open / Sync now / Pause·Resume / Delete menu. Links
 * into the detail view on click.
 */
export function ConnectorCard({ connector, streamCount }: ConnectorCardProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()

  const status = asConnectorStatus(connector.status)
  const meta = CONNECTOR_STATUS_META[status]
  const isSyncing = status === 'syncing' || status === 'provisioning'
  const isPaused = status === 'paused'

  const { syncNow, pause, resume, remove } = useConnectorMutations()

  const href = `/app/connectors/${connector.id}`
  const open = () => router.push(href)

  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const wrap = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    void fn()
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete connector?',
      description:
        'This removes the connector and stops syncing. Synced records are kept by default. This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) void remove(connector.id, 'keep')
  }

  return (
    <>
      <ConfirmDialog />
      <div
        className='group/connector-card relative flex cursor-pointer flex-col gap-2 rounded-2xl border bg-background p-3 hover:bg-primary-50/50 hover:outline-primary-100 dark:bg-primary-50 dark:hover:outline-primary-50/50'
        onClick={open}>
        <div className='flex w-full flex-row items-start gap-2'>
          <div className='relative shrink-0'>
            <div className='flex size-8 items-center justify-center overflow-hidden rounded-xl border'>
              <AppIcon
                iconId={iconIdForType(connector.type)}
                fallbackIconId={DEFAULT_CONNECTOR_ICON_ID}
                size='sm'
              />
            </div>
            <Tooltip content={connector.error ?? meta.label}>
              <div
                className={`absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-primary-50 ${meta.dot}`}
              />
            </Tooltip>
          </div>

          <div className='flex min-w-0 flex-1 flex-col'>
            <p className='line-clamp-2 text-sm font-semibold group-hover/connector-card:text-info'>
              {connector.name}
            </p>
            {connector.lastSyncedAt ? (
              <LastUpdated
                timestamp={new Date(connector.lastSyncedAt)}
                prefix='Synced '
                className='text-xs text-muted-foreground'
              />
            ) : (
              <span className='text-xs text-muted-foreground'>Never synced</span>
            )}
          </div>
        </div>

        <div className='mt-auto flex items-center justify-between gap-2'>
          <div className='flex min-w-0 items-center gap-1'>
            <Badge variant='pill' size='sm' className='shrink-0'>
              {connector.itemCount} record{connector.itemCount === 1 ? '' : 's'}
            </Badge>
            {streamCount != null && (
              <Badge variant='outline' size='sm' className='shrink-0'>
                {streamCount} stream{streamCount === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className='rounded-lg opacity-0 transition-opacity duration-300 group-hover/connector-card:opacity-100 data-[state=open]:bg-muted! data-[state=open]:opacity-100!'
                variant='ghost'
                size='icon-xs'
                onClick={stop}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' onClick={stop}>
              <DropdownMenuItem onClick={wrap(open)}>
                <FileText />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={wrap(() => syncNow(connector.id))} disabled={isSyncing}>
                <RefreshCw />
                Sync now
              </DropdownMenuItem>
              {isPaused ? (
                <DropdownMenuItem onClick={wrap(() => resume(connector.id))}>
                  <Play />
                  Resume
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={wrap(() => pause(connector.id))}>
                  <Pause />
                  Pause
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={wrap(handleDelete)} variant='destructive'>
                <Trash />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  )
}

/** Fallback icon when a connector type is unknown (kept for parity with the card). */
export const ConnectorFallbackIcon = Cable
