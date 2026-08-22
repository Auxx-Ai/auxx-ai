// apps/web/src/components/schedule/ui/qc/qc-photo-strip.tsx
//
// The shared QC checklist-item photo strip (37d §3) — one component for BOTH the worker surface
// (`qc-item-row.tsx`, assignee-guarded `addMy*`/`removeMy*`/`setMy*` mutations) and the office
// proof-of-work panel (`qc-item-display.tsx`, org-scoped `addVisit*`/`removeVisit*`/`setVisit*`
// mutations). Upload is identical on both (camera-capture `useFileUpload` on
// `entityType='visit_qc_item'`); the parent injects which mutation runs on the resulting assetId
// plus the caption/remove handlers, so the tile UI is written once. QC photos have no
// internal/customer split (37d), so the tile editor renders caption-only (`showInternal={false}`).

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { Camera, Loader2 } from 'lucide-react'
import { useRef } from 'react'
import { useFileUpload } from '~/components/file-upload/hooks/use-file-upload'
import { AttachmentThumbnail } from '~/components/files/utils/attachment-thumbnail'
import { PhotoTileEditor } from '~/components/pickers/photo-tile-editor'

/** One photo tile's data — mirrors `MyVisitQcItemPhoto`. */
export interface QcStripPhoto {
  attachmentId: string
  assetId: string | null
  caption: string | null
}

interface QcPhotoStripProps {
  itemId: string
  itemTitle: string
  photos: QcStripPhoto[]
  /** Attach the uploaded `MediaAsset` to the item (worker vs office mutation, injected). */
  onAddPhoto: (assetId: string) => void
  onRemovePhoto: (attachmentId: string) => void
  onSetCaption: (attachmentId: string, caption: string | null) => void
}

export function QcPhotoStrip({
  itemId,
  itemTitle,
  photos,
  onAddPhoto,
  onRemovePhoto,
  onSetCaption,
}: QcPhotoStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fileUpload = useFileUpload({
    entityType: 'visit_qc_item',
    entityId: itemId,
    onComplete: (results) => {
      const result = results.results[0]
      if (result?.success && result.metadata?.assetId) {
        onAddPhoto(result.metadata.assetId)
      } else if (result?.error) {
        toastError({ title: 'Error uploading photo', description: result.error })
      } else {
        // A "successful" upload carrying no `MediaAsset` id has nothing to attach. This used to
        // fall between the two branches above and be a silent no-op, which is exactly how the
        // missing `visit_qc_item` processor hid — the bytes landed, the strip stayed empty and
        // nothing was ever reported (docs/files-upload-architecture-guide.md §11.3).
        console.error('[qc-photo-strip] upload produced no MediaAsset id', {
          itemId,
          serverIdKind: result?.metadata?.serverIdKind,
          result,
        })
        toastError({
          title: 'Error uploading photo',
          description: 'The photo uploaded but no image record came back, so it was not attached.',
        })
      }
    },
    onError: (error) => toastError({ title: 'Error uploading photo', description: error }),
  })

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    try {
      await fileUpload.addFiles(files)
      await fileUpload.startUpload()
    } catch (error) {
      toastError({
        title: 'Error uploading photo',
        description: error instanceof Error ? error.message : 'Upload failed',
      })
    }
  }

  return (
    <div className='flex flex-wrap items-start gap-2'>
      {photos.map((photo) => (
        <PhotoTileEditor
          key={photo.attachmentId}
          trigger={
            <button type='button' className='block w-12 text-left'>
              <AttachmentThumbnail
                attachmentId={photo.attachmentId}
                alt={photo.caption ?? itemTitle}
              />
              {photo.caption && (
                <p className='mt-0.5 line-clamp-1 text-[10px] text-muted-foreground'>
                  {photo.caption}
                </p>
              )}
            </button>
          }
          name={itemTitle}
          caption={photo.caption ?? undefined}
          showInternal={false}
          onSave={(patch) => onSetCaption(photo.attachmentId, patch.caption ?? null)}
          onRemove={() => onRemovePhoto(photo.attachmentId)}
        />
      ))}
      <button
        type='button'
        onClick={() => fileInputRef.current?.click()}
        disabled={fileUpload.isUploading}
        aria-label='Add photo'
        className='flex size-12 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-accent/50'>
        {fileUpload.isUploading ? (
          <Loader2 className='size-4 animate-spin' />
        ) : (
          <Camera className='size-4' />
        )}
      </button>
      {/* `capture='environment'` opens the device camera directly on mobile — harmless on
          desktop (falls back to the file picker), useful when a dispatcher opens the panel on a
          phone. */}
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        capture='environment'
        className='hidden'
        onChange={handleFileChange}
      />
    </div>
  )
}
