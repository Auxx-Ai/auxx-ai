// apps/web/src/components/money/ui/line-builder/line-photo-popover.tsx

'use client'

// Per-line scouting-photo viewer/manager (plans/dispatch/40-line-photos-menu-and-viewer.md,
// refines 37b §4). The popover is controlled by the row so the `⋯` menu's "Add images"
// and the ⇧P shortcut can open it; the standing camera+count trigger only mounts when
// the line HAS photos (or while held open on a photo-less line — the CategoryBadge
// anchor-mount pattern). Content is a thumbnail grid (not the generic `FilePicker` file
// list): `useFieldFileUpload` takes recordId/fieldRef as plain args, so no
// `PropertyProvider` indirection is needed, and mounting it inside the popover content
// keeps per-row store subscriptions lazy. Read-only surfaces (invoice gather preview,
// an invoiced builder) get the same grid minus every mutation affordance — uploads
// started here survive the popover closing (the hook's module-level completion
// handlers, see file-input-field.tsx).

import type { ResourceField } from '@auxx/lib/resources/client'
import { type FileRef, getFileRefDownloadUrl } from '@auxx/types/file-ref'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Camera, EyeOff, File, FolderOpen, Upload } from 'lucide-react'
import { parseFileOptions } from '~/components/custom-fields/ui/file-options-editor'
import { useFieldFileUpload } from '~/components/fields/inputs/hooks/use-field-file-upload'
import { FileSelectDialog } from '~/components/file-select/file-select-dialog'
import { PhotoTileEditor } from '~/components/pickers/photo-tile-editor'
import type { RecordId } from '~/components/resources'

export function LinePhotoPopover({
  recordId,
  field,
  photoCount,
  readOnly,
  open,
  onOpenChange,
}: {
  recordId: RecordId
  field: ResourceField
  photoCount: number
  readOnly: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // No standing button on a photo-less line — adding lives in the `⋯` menu, which holds
  // this open while the transient trigger anchors the popover (CategoryBadge precedent).
  if (photoCount === 0 && !open) return null

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {/* `onMouseDown` preventDefault: opening must not blur (and collapse) a
            focused name input — mirrors the `⋯` menu trigger. */}
        <TreeRowButton
          persistent
          tabIndex={-1}
          tooltipText={`${photoCount} photo${photoCount === 1 ? '' : 's'}`}
          onMouseDown={(e) => e.preventDefault()}>
          <Camera />
          {photoCount > 0 && <span className='ml-0.5 text-[10px] tabular-nums'>{photoCount}</span>}
        </TreeRowButton>
      </PopoverTrigger>
      {/* `onFocusOutside` prevented: opening from the `⋯` menu races the menu's
          focus-scope teardown — its async focus restoration lands outside the
          just-mounted popover and would instantly dismiss it. Outside pointer
          clicks and Escape still close. `onOpenAutoFocus` prevented so opening
          never steals the line grid's focus. */}
      <PopoverContent
        align='end'
        className='w-80'
        onOpenAutoFocus={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}>
        {/* Grid mounts with the content — the upload hook's store subscriptions only
            exist while the popover is open. */}
        <LinePhotoGrid recordId={recordId} field={field} readOnly={readOnly} />
      </PopoverContent>
    </Popover>
  )
}

/** Thumbnail grid + add actions for one line's `line_item_photos` field. */
function LinePhotoGrid({
  recordId,
  field,
  readOnly,
}: {
  recordId: RecordId
  field: ResourceField
  readOnly: boolean
}) {
  const fileOptions = parseFileOptions(field.options)
  const {
    displayFiles,
    uploadingFiles,
    canAddMore,
    remainingSlots,
    supportsCameraCapture,
    openNativeFilePicker,
    openCameraCapture,
    handleBrowseFilesSelected,
    removeFile,
    updatePhotoMeta,
    browseOpen,
    setBrowseOpen,
  } = useFieldFileUpload({ recordId, fieldRef: field.id, fileOptions })

  const isEmpty = displayFiles.length === 0 && uploadingFiles.length === 0

  return (
    <div className='flex flex-col gap-2'>
      {isEmpty ? (
        <p className='py-1 text-center text-muted-foreground text-xs'>No photos yet</p>
      ) : (
        <div className='grid grid-cols-3 gap-2'>
          {displayFiles.map((file) => {
            const tile = <PhotoTile file={file} />
            if (readOnly) return <div key={file.id}>{tile}</div>
            // The whole tile opens the caption/internal/remove editor — its Sheet is
            // Dialog-in-Popover, the sanctioned nesting (photo-tile-editor.tsx).
            return (
              <PhotoTileEditor
                key={file.id}
                trigger={
                  <button type='button' className='block w-full text-left'>
                    {tile}
                  </button>
                }
                name={file.name}
                caption={file.caption}
                internal={file.internal}
                onSave={(patch) => updatePhotoMeta(file.id, patch)}
                onRemove={() => void removeFile(file.id)}
              />
            )
          })}
          {uploadingFiles.map((file) => (
            <div
              key={file.id}
              className='flex aspect-square items-center justify-center rounded-md border border-dashed bg-muted/50'>
              <span className='text-[10px] text-muted-foreground tabular-nums'>
                {file.progress != null ? `${Math.round(file.progress)}%` : '…'}
              </span>
            </div>
          ))}
        </div>
      )}

      {!readOnly &&
        (canAddMore ? (
          <div className='flex items-center gap-1.5'>
            {supportsCameraCapture && (
              <Button variant='outline' size='xs' onClick={openCameraCapture}>
                <Camera />
                Take photo
              </Button>
            )}
            <Button variant='outline' size='xs' onClick={openNativeFilePicker}>
              <Upload />
              Upload
            </Button>
            <Button variant='outline' size='xs' onClick={() => setBrowseOpen(true)}>
              <FolderOpen />
              Browse
            </Button>
          </div>
        ) : (
          <p className='text-center text-muted-foreground text-xs'>Maximum photos reached</p>
        ))}

      {browseOpen && (
        <FileSelectDialog
          open={browseOpen}
          onOpenChange={setBrowseOpen}
          onFilesSelected={handleBrowseFilesSelected}
          allowMultiple={fileOptions.allowMultiple}
          maxSelection={remainingSlots}
          title='Select photos'
          confirmText='Attach'
        />
      )}
    </div>
  )
}

/** One square thumbnail — caption in fine print beneath, `EyeOff` badge when internal. */
function PhotoTile({
  file,
}: {
  file: {
    ref: FileRef
    name: string
    mimeType: string | null
    caption?: string
    internal?: boolean
  }
}) {
  // Defensive — the field is images-only, but a browsed-in non-image still gets a tile.
  const isImage = !!file.mimeType?.startsWith('image/')

  return (
    <div className='min-w-0'>
      <div className='relative aspect-square overflow-hidden rounded-md border'>
        {isImage ? (
          <img
            src={getFileRefDownloadUrl(file.ref)}
            alt={file.caption ?? file.name}
            className='size-full object-cover'
            loading='lazy'
          />
        ) : (
          <div className='flex size-full items-center justify-center bg-muted'>
            <File className='size-5 text-muted-foreground' />
          </div>
        )}
        {file.internal && (
          <span className='absolute top-1 right-1 rounded bg-background/80 p-0.5'>
            <EyeOff className='size-3 text-muted-foreground' />
          </span>
        )}
      </div>
      {file.caption && (
        <p className='mt-0.5 line-clamp-1 text-[10px] text-muted-foreground'>{file.caption}</p>
      )}
    </div>
  )
}
