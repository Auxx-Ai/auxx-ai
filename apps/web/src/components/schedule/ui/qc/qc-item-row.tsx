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
import { Image as ImageIcon, MessageSquare } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { QcPhotoStrip } from './qc-photo-strip'

type MyVisitQcItem = RouterOutputs['dispatch']['listMyVisitQcItems']['items'][number]

interface QcItemRowProps {
  visitId: string
  item: MyVisitQcItem
}

export function QcItemRow({ visitId, item }: QcItemRowProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState(item.note ?? '')
  const savedNoteRef = useRef(item.note ?? '')

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

  const setCaption = api.dispatch.setMyQcItemPhotoCaption.useMutation({
    onSuccess: () => utils.dispatch.listMyVisitQcItems.invalidate({ visitId }),
    onError: (error) => toastError({ title: 'Error saving caption', description: error.message }),
  })

  const handleNoteBlur = () => {
    if (noteDraft === savedNoteRef.current) return
    savedNoteRef.current = noteDraft
    setNote.mutate({ itemId: item.id, note: noteDraft.trim() ? noteDraft : null })
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
        <QcPhotoStrip
          itemId={item.id}
          itemTitle={item.title}
          photos={item.photos}
          onAddPhoto={(assetId) => addPhoto.mutate({ itemId: item.id, assetId })}
          onRemovePhoto={(attachmentId) => removePhoto.mutate({ itemId: item.id, attachmentId })}
          onSetCaption={(attachmentId, caption) =>
            setCaption.mutate({ itemId: item.id, attachmentId, caption })
          }
        />
      </div>
    </TreeRow>
  )
}
