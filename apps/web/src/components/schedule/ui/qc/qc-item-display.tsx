// apps/web/src/components/schedule/ui/qc/qc-item-display.tsx
//
// The dispatcher-side counterpart of `QcItemRow` (plan 17 Part A). Deliberately a SIBLING, not a
// shared base: the worker row is wired to the assignee-guarded `my*` mutations for the checkbox
// and note; those stay worker attestations and render read-only here. Photos are the exception —
// with `photoEditing` supplied (office capture, 37d §4) the row hosts the shared, editable
// `QcPhotoStrip` wired to the org-scoped `*Visit*` mutations, so a dispatcher can add/caption/
// remove photos from the proof-of-work panel. Without it, photos render as static thumbnails.

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Circle, CircleCheck, Image as ImageIcon, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { AttachmentThumbnail } from '~/components/files/utils/attachment-thumbnail'
import { QcPhotoStrip } from './qc-photo-strip'

/** The display slice of a checklist item — both `listMyVisitQcItems` and the dispatcher's
 * `listVisitQcItems` rows satisfy it. */
export interface QcItemDisplayData {
  id: string
  title: string
  isRequired: boolean
  note: string | null
  checkedAt: Date | null
  photos: { attachmentId: string; assetId: string | null; caption: string | null }[]
}

/** Office photo-editing handlers (37d §4) — supplied by the proof-of-work panel to make the
 * photo strip editable while checks/notes stay read-only. */
export interface QcItemPhotoEditing {
  onAddPhoto: (itemId: string, assetId: string) => void
  onRemovePhoto: (itemId: string, attachmentId: string) => void
  onSetCaption: (itemId: string, attachmentId: string, caption: string | null) => void
}

interface QcItemDisplayProps {
  item: QcItemDisplayData
  photoEditing?: QcItemPhotoEditing
}

export function QcItemDisplay({ item, photoEditing }: QcItemDisplayProps) {
  const [isOpen, setIsOpen] = useState(false)

  const isChecked = !!item.checkedAt
  const hasNote = !!item.note
  const hasPhotos = item.photos.length > 0
  // With office editing on, the row must open even when empty so a photo can be added.
  const expandable = hasNote || hasPhotos || !!photoEditing

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
        hasNote || hasPhotos ? (
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
          {photoEditing ? (
            <QcPhotoStrip
              itemId={item.id}
              itemTitle={item.title}
              photos={item.photos}
              onAddPhoto={(assetId) => photoEditing.onAddPhoto(item.id, assetId)}
              onRemovePhoto={(attachmentId) => photoEditing.onRemovePhoto(item.id, attachmentId)}
              onSetCaption={(attachmentId, caption) =>
                photoEditing.onSetCaption(item.id, attachmentId, caption)
              }
            />
          ) : (
            hasPhotos && (
              <div className='flex flex-wrap items-start gap-2'>
                {item.photos.map((photo) => (
                  <div key={photo.attachmentId} className='w-12'>
                    <AttachmentThumbnail
                      attachmentId={photo.attachmentId}
                      alt={photo.caption ?? item.title}
                    />
                    {photo.caption && (
                      <p className='mt-0.5 line-clamp-1 text-[10px] text-muted-foreground'>
                        {photo.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </TreeRow>
  )
}
