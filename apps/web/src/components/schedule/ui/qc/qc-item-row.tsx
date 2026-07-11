// apps/web/src/components/schedule/ui/qc/qc-item-row.tsx
//
// One quality-check row (08-worker-surface.md §5, user-locked decision: every item — worker
// AND admin — renders as a `TreeRow`). The single line is check + title + a "Required" badge
// (while open) + a note/photo indicator; expanding it reveals the note textarea and photo strip.
// Checking is optimistic (patches the `listMyVisitQcItems` cache immediately, rolls back on
// error); the note only writes on blur, and only when it actually changed.

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Camera, Image as ImageIcon, Loader2, MessageSquare, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useFileUpload } from '~/components/file-upload/hooks/use-file-upload'
import { AttachmentThumbnail } from '~/components/files/utils/attachment-thumbnail'
import { api, type RouterOutputs } from '~/trpc/react'

type MyVisitQcItem = RouterOutputs['dispatch']['listMyVisitQcItems']['items'][number]

interface QcItemRowProps {
  visitId: string
  item: MyVisitQcItem
}

export function QcItemRow({ visitId, item }: QcItemRowProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState(item.note ?? '')
  const savedNoteRef = useRef(item.note ?? '')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const utils = api.useUtils()

  const setChecked = api.dispatch.setMyQcItemChecked.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.listMyVisitQcItems.cancel({ visitId })
      const previous = utils.dispatch.listMyVisitQcItems.getData({ visitId })
      if (previous) {
        utils.dispatch.listMyVisitQcItems.setData(
          { visitId },
          {
            items: previous.items.map((row) =>
              row.id === vars.itemId ? { ...row, checkedAt: vars.checked ? new Date() : null } : row
            ),
          }
        )
      }
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) utils.dispatch.listMyVisitQcItems.setData({ visitId }, ctx.previous)
      toastError({ title: 'Error updating check', description: error.message })
    },
    onSettled: () => utils.dispatch.listMyVisitQcItems.invalidate({ visitId }),
  })

  const setNote = api.dispatch.setMyQcItemNote.useMutation({
    onSuccess: () => utils.dispatch.listMyVisitQcItems.invalidate({ visitId }),
    onError: (error) => toastError({ title: 'Error saving note', description: error.message }),
  })

  const addPhoto = api.dispatch.addMyQcItemPhoto.useMutation({
    onSuccess: () => utils.dispatch.listMyVisitQcItems.invalidate({ visitId }),
    onError: (error) => toastError({ title: 'Error attaching photo', description: error.message }),
  })

  const removePhoto = api.dispatch.removeMyQcItemPhoto.useMutation({
    onSuccess: () => utils.dispatch.listMyVisitQcItems.invalidate({ visitId }),
    onError: (error) => toastError({ title: 'Error removing photo', description: error.message }),
  })

  const fileUpload = useFileUpload({
    entityType: 'visit_qc_item',
    entityId: item.id,
    onComplete: (results) => {
      const result = results.results[0]
      if (result?.success && result.metadata?.assetId) {
        addPhoto.mutate({ itemId: item.id, assetId: result.metadata.assetId })
      } else if (result?.error) {
        toastError({ title: 'Error uploading photo', description: result.error })
      }
    },
    onError: (error) => toastError({ title: 'Error uploading photo', description: error }),
  })

  const handleNoteBlur = () => {
    if (noteDraft === savedNoteRef.current) return
    savedNoteRef.current = noteDraft
    setNote.mutate({ itemId: item.id, note: noteDraft.trim() ? noteDraft : null })
  }

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

  const isChecked = !!item.checkedAt
  const hasNote = !!item.note
  const hasPhotos = item.photos.length > 0

  return (
    <TreeRow
      icon={
        // stopPropagation — the row itself toggles open/closed on click; checking the box
        // shouldn't also flip the expansion.
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isChecked}
            disabled={setChecked.isPending}
            onCheckedChange={(checked) =>
              setChecked.mutate({ itemId: item.id, checked: checked === true })
            }
          />
        </span>
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
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((open) => !open)}>
      <div className='flex flex-col gap-2 py-2 pl-9 pr-2'>
        <Textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={handleNoteBlur}
          placeholder='Add a note…'
          rows={2}
          className='text-sm'
        />
        <div className='flex flex-wrap items-center gap-2'>
          {item.photos.map((photo) => (
            <div key={photo.attachmentId} className='relative'>
              <AttachmentThumbnail attachmentId={photo.attachmentId} alt={item.title} />
              <button
                type='button'
                onClick={() =>
                  removePhoto.mutate({ itemId: item.id, attachmentId: photo.attachmentId })
                }
                disabled={removePhoto.isPending}
                aria-label='Remove photo'
                className='absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground'>
                <X className='size-2.5' />
              </button>
            </div>
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
          {/* First repo-wide `capture=` usage — one attribute on the input `useFileUpload`
              feeds; opens the device camera directly on mobile instead of the file picker. */}
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            capture='environment'
            className='hidden'
            onChange={handleFileChange}
          />
        </div>
      </div>
    </TreeRow>
  )
}
