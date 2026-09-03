// apps/web/src/components/fields/connector-lock-badge.tsx

'use client'

import type { CellSyncInfo } from '@auxx/lib/data-connectors/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldId } from '@auxx/types/field'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Lock, PauseCircle, RefreshCw } from 'lucide-react'
import type { MouseEvent, PointerEvent } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConnectorName } from '~/components/resources/hooks/use-connector-name'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { api } from '~/trpc/react'

interface OwnedBadgeProps {
  /**
   * `owned`: the field/column is hard read-only (managed by the connector).
   * A lock, no menu.
   */
  mode: 'owned'
  /** Owning DataConnector id. */
  connectorId: string
  className?: string
}

interface ContributingBadgeProps {
  /**
   * `contributing`: the cell is still editable but bound to a connector. The
   * icon opens a menu to pause or resume syncing this one field on this record.
   */
  mode: 'contributing'
  /** The cell's sync state from the field-value batch response. */
  sync: CellSyncInfo
  /**
   * The cell the menu acts on. Both omitted (a field-path cell, where the
   * bound record is not the row's record) renders the badge tooltip-only.
   */
  recordId?: RecordId
  fieldId?: FieldId
  /**
   * The field is multi-value (`options.multi`): the connector owns only its own
   * row, so the synced copy softens to "Some values synced by <connector>"
   * (the badge stays cell-grained in v1, no per-chip badges).
   */
  multi?: boolean
  className?: string
}

type ConnectorLockBadgeProps = OwnedBadgeProps | ContributingBadgeProps

/**
 * Inline ownership indicator for data-connector-managed fields/cells.
 *
 * - `owned`: a small lock icon with "Managed by <connector>". The column is
 *   read-only (provisioning already set `isUpdatable=false`).
 * - `contributing`: a small sync icon whose colour and copy follow the cell's
 *   sync state (synced, edited, paused), opening a menu that pauses or resumes
 *   the connector for this field on this record. The cell stays editable.
 *
 * The connector name resolves from the org-scoped connector list (deduped).
 * Renders a generic label until the name loads / if it can't be resolved.
 */
export function ConnectorLockBadge(props: ConnectorLockBadgeProps) {
  if (props.mode === 'owned') {
    return <OwnedBadge connectorId={props.connectorId} className={props.className} />
  }
  return (
    <ContributingBadge
      sync={props.sync}
      recordId={props.recordId}
      fieldId={props.fieldId}
      multi={props.multi}
      className={props.className}
    />
  )
}

function OwnedBadge({ connectorId, className }: Omit<OwnedBadgeProps, 'mode'>) {
  const name = useConnectorName(connectorId)
  const content = `Managed by ${name ?? 'a data connector'}`
  return (
    <Tooltip content={content} side='top'>
      <Lock className={cn('size-3 shrink-0 text-neutral-400', className)} aria-label={content} />
    </Tooltip>
  )
}

const STATE_ICON = {
  synced: RefreshCw,
  edited: RefreshCw,
  paused: PauseCircle,
} as const

const STATE_COLOR = {
  synced: 'text-blue-400',
  edited: 'text-amber-500',
  paused: 'text-neutral-400',
} as const

function stopCellEditing(e: MouseEvent | PointerEvent) {
  // The badge sits inside a row / cell whose click starts editing. React
  // events bubble through portals too, so the menu content stops them as well.
  e.stopPropagation()
}

function ContributingBadge({
  sync,
  recordId,
  fieldId,
  multi,
  className,
}: Omit<ContributingBadgeProps, 'mode'>) {
  const name = useConnectorName(sync.connectorId)
  const who = name ?? 'a data connector'
  const invalidateResource = useFieldValueStore((s) => s.invalidateResource)
  const setFieldPin = api.dataConnector.setFieldPin.useMutation()

  const Icon = STATE_ICON[sync.state]
  const content =
    sync.state === 'paused'
      ? `Sync paused for this field, ${who} will not change it`
      : sync.state === 'edited'
        ? `Edited here, ${who} will overwrite it on the next sync`
        : multi
          ? `Some values synced by ${who}, other values are kept`
          : `Synced by ${who}, may be overwritten on the next sync`

  const icon = (
    <Icon
      className={cn('size-3 shrink-0', STATE_COLOR[sync.state], className)}
      aria-label={content}
    />
  )

  if (!recordId || !fieldId) {
    return (
      <Tooltip content={content} side='top'>
        {icon}
      </Tooltip>
    )
  }

  const setPinned = (pinned: boolean) => {
    setFieldPin.mutate(
      { recordId, fieldId, connectorId: sync.connectorId, pinned },
      {
        onSuccess: () => invalidateResource(recordId),
        onError: (error) =>
          toastError({
            title: 'Could not change sync for this field',
            description: error.message,
          }),
      }
    )
  }

  return (
    <DropdownMenu>
      <Tooltip content={content} side='top' allowInteraction>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className='inline-flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring'
            aria-label={content}
            onClick={stopCellEditing}
            onPointerDown={stopCellEditing}>
            {icon}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align='start'
        className='w-[240px]'
        onClick={stopCellEditing}
        onPointerDown={stopCellEditing}>
        {sync.state === 'paused' ? (
          <DropdownMenuItem
            disabled={setFieldPin.isPending}
            onSelect={() => setPinned(false)}
            className='flex-col items-start gap-0.5'>
            <span>Resume syncing</span>
            {!sync.willOverwrite && (
              <span className='text-xs text-muted-foreground'>
                Clear the value to let {who} fill it
              </span>
            )}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={setFieldPin.isPending} onSelect={() => setPinned(true)}>
            Stop syncing this field
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
