// apps/web/src/components/schedule/ui/qc/qc-item-display.tsx
//
// Read-only presentation of one quality-check row — the dispatcher-side counterpart of
// `QcItemRow` (plan 17 Part A). Deliberately a SIBLING, not a shared base: the worker row is
// wired to the assignee-guarded `my*` mutations (checkbox, note textarea, photo add/remove),
// and threading all of that through props would bloat both. This renders the same TreeRow
// shape with a static check glyph, and expands (only when there's anything to show) into the
// note as static text + the photo strip without remove/camera controls.

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Circle, CircleCheck, Image as ImageIcon, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { AttachmentThumbnail } from '~/components/files/utils/attachment-thumbnail'

/** The display slice of a checklist item — both `listMyVisitQcItems` and the dispatcher's
 * `listVisitQcItems` rows satisfy it. */
export interface QcItemDisplayData {
  id: string
  title: string
  isRequired: boolean
  note: string | null
  checkedAt: Date | null
  photos: { attachmentId: string; assetId: string | null }[]
}

interface QcItemDisplayProps {
  item: QcItemDisplayData
}

export function QcItemDisplay({ item }: QcItemDisplayProps) {
  const [isOpen, setIsOpen] = useState(false)

  const isChecked = !!item.checkedAt
  const hasNote = !!item.note
  const hasPhotos = item.photos.length > 0
  const expandable = hasNote || hasPhotos

  return (
    <TreeRow
      icon={
        isChecked ? (
          <CircleCheck className='size-4 text-primary' />
        ) : (
          <Circle className='size-4 text-muted-foreground/50' />
        )
      }
      title={
        <span className={cn(isChecked && 'text-muted-foreground line-through')}>{item.title}</span>
      }
      secondary={
        item.isRequired && !isChecked ? (
          <Badge variant='amber' size='sm'>
            Required
          </Badge>
        ) : undefined
      }
      actions={
        expandable ? (
          <div className='flex items-center gap-1.5 text-muted-foreground'>
            {hasNote && <MessageSquare className='size-3.5' />}
            {hasPhotos && (
              <span className='flex items-center gap-0.5 text-xs'>
                <ImageIcon className='size-3.5' />
                {item.photos.length}
              </span>
            )}
          </div>
        ) : undefined
      }
      expandable={expandable}
      isOpen={isOpen}
      onToggleOpen={expandable ? () => setIsOpen((open) => !open) : undefined}>
      {expandable && (
        <div className='flex flex-col gap-2 py-2 pl-9 pr-2'>
          {hasNote && <p className='whitespace-pre-wrap text-sm'>{item.note}</p>}
          {hasPhotos && (
            <div className='flex flex-wrap items-center gap-2'>
              {item.photos.map((photo) => (
                <AttachmentThumbnail
                  key={photo.attachmentId}
                  attachmentId={photo.attachmentId}
                  alt={item.title}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </TreeRow>
  )
}
