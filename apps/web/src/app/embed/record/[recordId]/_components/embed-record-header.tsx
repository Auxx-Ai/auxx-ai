// apps/web/src/app/embed/record/[recordId]/_components/embed-record-header.tsx
'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { Box } from 'lucide-react'
import { getIconComponent } from '~/components/detail-view/utils'
import { useRecord, useResource } from '~/components/resources'

interface EmbedRecordHeaderProps {
  recordId: RecordId
}

/**
 * Compact header lifted from `DetailViewCardHeader` — avatar + displayName,
 * sized for the ~380px iframe. The "Open in Auxx" affordance lives in the
 * outer extension shell, so this is just identity.
 */
export function EmbedRecordHeader({ recordId }: EmbedRecordHeaderProps) {
  const { entityDefinitionId } = parseRecordId(recordId)
  const { record } = useRecord({ recordId })
  const { resource } = useResource(entityDefinitionId)

  const IconComponent = resource?.icon ? getIconComponent(resource.icon) : Box
  const color = resource?.color
  const displayName = record?.displayName ?? '…'

  return (
    <div className='flex flex-row items-center justify-start gap-3 border-b px-3 py-2'>
      <div
        className='flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted'
        style={color ? { backgroundColor: `${color}20` } : undefined}>
        <IconComponent
          className='size-6 text-neutral-500 dark:text-foreground'
          style={color ? { color } : undefined}
        />
      </div>
      <div className='flex w-full min-w-0 flex-col items-start'>
        <div className='truncate text-sm font-medium text-neutral-900 dark:text-neutral-400'>
          {displayName}
        </div>
        {resource?.label && (
          <div className='truncate text-xs text-neutral-500'>{resource.label}</div>
        )}
      </div>
    </div>
  )
}
