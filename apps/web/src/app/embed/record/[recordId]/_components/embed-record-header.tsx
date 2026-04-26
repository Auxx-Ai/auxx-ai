// apps/web/src/app/embed/record/[recordId]/_components/embed-record-header.tsx
'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Box, ExternalLink } from 'lucide-react'
import { getIconComponent } from '~/components/detail-view/utils'
import { useRecord, useRecordLink, useResource } from '~/components/resources'

interface EmbedRecordHeaderProps {
  recordId: RecordId
}

/**
 * Compact header lifted from `DetailViewCardHeader` — avatar + displayName +
 * "Open in Auxx" affordance, sized for the ~380px iframe. The extension's
 * outer wrapper used to render its own title row above this; we collapsed
 * the two so identity + the Open CTA live in one place.
 */
export function EmbedRecordHeader({ recordId }: EmbedRecordHeaderProps) {
  const { entityDefinitionId } = parseRecordId(recordId)
  const { record } = useRecord({ recordId })
  const { resource } = useResource(entityDefinitionId)
  const openHref = useRecordLink(recordId)

  const IconComponent = resource?.icon ? getIconComponent(resource.icon) : Box
  const color = resource?.color
  const displayName = record?.displayName ?? '…'

  return (
    <div className='flex flex-row items-center gap-3 border-b px-3 py-2'>
      <div
        className='flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted'
        style={color ? { backgroundColor: `${color}20` } : undefined}>
        <IconComponent
          className='size-6 text-neutral-500 dark:text-foreground'
          style={color ? { color } : undefined}
        />
      </div>
      <div className='flex min-w-0 flex-1 flex-col items-start'>
        <div className='truncate text-sm font-medium text-neutral-900 dark:text-neutral-400'>
          {displayName}
        </div>
        {resource?.label && (
          <div className='truncate text-xs text-neutral-500'>{resource.label}</div>
        )}
      </div>
      {openHref && (
        <Button asChild variant='ghost' size='sm' className='shrink-0 gap-1'>
          <a href={openHref} target='_blank' rel='noreferrer'>
            <ExternalLink className='size-3.5' />
            Open
          </a>
        </Button>
      )}
    </div>
  )
}
