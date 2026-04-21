// apps/web/src/components/kopilot/ui/blocks/entity-card-item.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import Link from 'next/link'
import { useRecord, useRecordLink, useResource } from '~/components/resources'
import type { EntitySnapshotData } from './block-schemas'

interface EntityCardItemProps {
  recordId: string
  /** Snapshot written at turn time — rendered when live data is pending or deleted */
  snapshot?: EntitySnapshotData
  /** Show a checkbox on the right. When provided, the card is not wrapped in a Link. */
  selectable?: {
    checked: boolean
    onChange: (checked: boolean) => void
  }
}

export function EntityCardItem({ recordId, snapshot, selectable }: EntityCardItemProps) {
  const { record, isNotFound, hasLoadedOnce } = useRecord({ recordId })
  const entityDefId = getDefinitionId(recordId)
  const { resource } = useResource(entityDefId)
  const href = useRecordLink(recordId)

  // Ignore snapshot.displayName when it equals the recordId — a legacy
  // fallback from older turns poisoned snapshots with the raw id.
  const snapshotName =
    snapshot?.displayName && snapshot.displayName !== recordId ? snapshot.displayName : undefined
  const displayName = record?.displayName ?? snapshotName
  const secondaryInfo = record?.secondaryInfo ?? snapshot?.summary
  const avatarUrl = record?.avatarUrl

  // Skeleton when we have nothing to show yet and haven't finished a fetch attempt.
  // `hasLoadedOnce` covers the first-render gap before useRecord's batch fetch resolves.
  if (!record && !snapshot && !hasLoadedOnce) {
    return <EntityCardItemSkeleton />
  }

  // Nothing to render, fetch resolved as missing — placeholder with raw id
  if (!record && !snapshot && isNotFound) {
    return <EntityCardUnavailable recordId={recordId} />
  }

  const initials = displayName
    ?.split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  // Deleted badge: no live record, but snapshot lets us still render something meaningful
  const showDeleted = !record && !!snapshot && isNotFound

  const inner = (
    <div className='flex items-center gap-3 rounded-2xl bg-background p-1 shadow-sm ring-1 ring-border transition-colors hover:bg-muted/50'>
      <Avatar className='size-8'>
        {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
        <AvatarFallback className='text-xs'>
          {initials || (
            <EntityIcon
              iconId={resource?.icon || 'circle'}
              color={resource?.color || 'gray'}
              size='xs'
            />
          )}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate text-sm font-medium'>{displayName ?? 'Unknown'}</span>
          {showDeleted && (
            <Badge variant='outline' className='shrink-0 text-[10px] uppercase'>
              Deleted
            </Badge>
          )}
        </div>
        {secondaryInfo && (
          <div className='truncate text-xs text-muted-foreground'>{secondaryInfo}</div>
        )}
      </div>
      {selectable && (
        <div className='h-full px-2'>
          <Checkbox checked={selectable.checked} onCheckedChange={selectable.onChange} />
        </div>
      )}
    </div>
  )

  // Don't link out to deleted records
  if (selectable || showDeleted) return inner
  return href ? <Link href={href}>{inner}</Link> : inner
}

function EntityCardItemSkeleton() {
  return (
    <div className='flex items-center gap-3 rounded-lg bg-background p-3 shadow-sm ring-1 ring-border'>
      <Skeleton className='size-8 rounded-full' />
      <div className='min-w-0 flex-1 space-y-1.5'>
        <Skeleton className='h-4 w-32' />
        <Skeleton className='h-3 w-24' />
      </div>
    </div>
  )
}

function EntityCardUnavailable({ recordId }: { recordId: string }) {
  return (
    <div className='flex items-center gap-3 rounded-2xl bg-muted/30 p-2 text-xs text-muted-foreground ring-1 ring-border'>
      <span className='truncate'>Record unavailable</span>
      <span className='truncate font-mono text-[10px] opacity-70'>{recordId}</span>
    </div>
  )
}
