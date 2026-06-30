// apps/web/src/components/data-connectors/ui/connector-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ListCard } from '@auxx/ui/components/list-card'
import { Cable, FileText, FlaskConical, Pause, Play, RefreshCw, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppIcon } from '~/components/apps/ui/app-icon'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { useConnectorMutations } from '../hooks/use-connector-mutations'
import { asConnectorStatus, CONNECTOR_STATUS_META } from './connector-status'

/** A connector row as returned by `dataConnector.list`. */
export interface ConnectorCardData {
  id: string
  name: string
  type: string
  /** Set when seeded from a first-party connector template (origin = template). */
  templateId: string | null
  status: string
  itemCount: number
  lastSyncedAt: Date | string | null
  error: string | null
}

/** Where the connector came from — drives the origin badge. */
type ConnectorOrigin = 'app' | 'template' | 'manual'

/** App connectors carry `app:<slug>`; template instances stamp `templateId`; else hand-built. */
function connectorOrigin(connector: ConnectorCardData): ConnectorOrigin {
  if (connector.type.startsWith('app:')) return 'app'
  if (connector.templateId) return 'template'
  return 'manual'
}

const ORIGIN_LABEL: Record<ConnectorOrigin, string> = {
  app: 'App',
  template: 'Template',
  manual: 'Manual',
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
  const bulkMode = useBulkMode()
  const selected = useIsSelected(connector.id)
  const pending = useIsPending(connector.id)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const status = asConnectorStatus(connector.status)
  const meta = CONNECTOR_STATUS_META[status]
  const origin = connectorOrigin(connector)
  const isSyncing = status === 'syncing' || status === 'provisioning'
  const isPaused = status === 'paused'

  const { syncNow, sampleSync, pause, resume, remove } = useConnectorMutations()

  /** Default per-stream sample size for the menu "Sample sync" shortcut (trial-sync §5.3). */
  const DEFAULT_SAMPLE_SIZE = 100

  const href = `/app/connectors/${connector.id}`
  const open = () => router.push(href)

  const handleDelete = async (syncedData: 'keep' | 'archive' | 'delete') => {
    const copy = {
      keep: 'Synced records are kept; only the connector is removed.',
      archive: 'Synced records are archived and the connector is removed.',
      delete: 'Synced records and the connector are permanently deleted.',
    }[syncedData]
    const ok = await confirm({
      title: 'Delete connector?',
      description: `${copy} This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) void remove(connector.id, syncedData)
  }

  const wrap = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    void fn()
  }

  return (
    <>
      <ConfirmDialog />
      <ListCard
        href={href}
        ariaLabel={connector.name}
        selectable
        selecting={bulkMode}
        selected={selected}
        onSelectChange={(_, e) => toggle(connector.id, { shiftKey: e.shiftKey })}
        pending={pending}
        pendingLabel={pendingLabel}
        title={connector.name}
        icon={
          <AppIcon
            iconId={iconIdForType(connector.type)}
            fallbackIconId={DEFAULT_CONNECTOR_ICON_ID}
            size='sm'
          />
        }
        status={{ tone: meta.tone, label: connector.error ?? meta.label }}
        subtitle={
          connector.lastSyncedAt ? (
            <LastUpdated timestamp={new Date(connector.lastSyncedAt)} prefix='Synced ' />
          ) : (
            'Never synced'
          )
        }
        descriptionLines={0}
        badges={
          <>
            <Badge variant='outline' size='sm' className='shrink-0'>
              {ORIGIN_LABEL[origin]}
            </Badge>
            <Badge variant='pill' size='sm' className='shrink-0'>
              {connector.itemCount} record{connector.itemCount === 1 ? '' : 's'}
            </Badge>
            {streamCount != null && (
              <Badge variant='outline' size='sm' className='shrink-0'>
                {streamCount} stream{streamCount === 1 ? '' : 's'}
              </Badge>
            )}
          </>
        }
        menu={
          <>
            <DropdownMenuItem onClick={wrap(open)}>
              <FileText />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onClick={wrap(() => syncNow(connector.id))} disabled={isSyncing}>
              <RefreshCw />
              Sync now
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={wrap(() => sampleSync(connector.id, DEFAULT_SAMPLE_SIZE))}
              disabled={isSyncing}>
              <FlaskConical />
              Sample sync
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
            {connector.itemCount > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger variant='destructive'>
                  <Trash />
                  Delete
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={wrap(() => handleDelete('keep'))}>
                    Delete, keep synced records
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={wrap(() => handleDelete('archive'))}>
                    Delete, archive synced records
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant='destructive'
                    onClick={wrap(() => handleDelete('delete'))}>
                    Delete connector and synced records
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem variant='destructive' onClick={wrap(() => handleDelete('delete'))}>
                <Trash />
                Delete
              </DropdownMenuItem>
            )}
          </>
        }
      />
    </>
  )
}

/** Fallback icon when a connector type is unknown (kept for parity with the card). */
export const ConnectorFallbackIcon = Cable
