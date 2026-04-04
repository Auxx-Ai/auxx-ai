// apps/web/src/components/kopilot/ui/blocks/entity-card-item.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import Link from 'next/link'
import { useRecord, useRecordLink, useResource } from '~/components/resources'

interface EntityCardItemProps {
  recordId: string
  /** Show a checkbox on the right. When provided, the card is not wrapped in a Link. */
  selectable?: {
    checked: boolean
    onChange: (checked: boolean) => void
  }
}

export function EntityCardItem({ recordId, selectable }: EntityCardItemProps) {
  const { record, isLoading } = useRecord({ recordId })
  const entityDefId = getDefinitionId(recordId)
  const { resource } = useResource(entityDefId)
  const href = useRecordLink(recordId)

  if (isLoading && !record) {
    return <EntityCardItemSkeleton />
  }

  const initials = record?.displayName
    ?.split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const inner = (
    <div className='flex items-center gap-3 rounded-2xl bg-background p-1 shadow-sm ring-1 ring-border transition-colors hover:bg-muted/50'>
      <Avatar className='size-8'>
        {record?.avatarUrl ? <AvatarImage src={record.avatarUrl} /> : null}
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
        <div className='truncate text-sm font-medium'>{record?.displayName ?? 'Unknown'}</div>
        {record?.secondaryInfo && (
          <div className='truncate text-xs text-muted-foreground'>{record.secondaryInfo}</div>
        )}
      </div>
      {selectable && (
        <div className='h-full px-2'>
          <Checkbox checked={selectable.checked} onCheckedChange={selectable.onChange} />
        </div>
      )}
    </div>
  )

  return selectable ? inner : href ? <Link href={href}>{inner}</Link> : inner
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
