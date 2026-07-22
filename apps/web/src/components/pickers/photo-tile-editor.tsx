// apps/web/src/components/pickers/photo-tile-editor.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@auxx/ui/components/sheet'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useIsMobile } from '~/hooks/use-mobile'

interface PhotoTileEditorProps {
  /** Element that opens the editor — usually the photo thumbnail itself. */
  trigger: ReactNode
  name: string
  caption?: string
  internal?: boolean
  onSave: (patch: { caption?: string; internal?: boolean }) => Promise<void> | void
  onRemove: () => void
}

/**
 * Caption + "Internal" + Remove editor for one photo tile (37b-scouting-quote-photos.md
 * §2 tile UI). Opens as a `Sheet` — a side panel on desktop, a bottom sheet on mobile
 * (camera-capture-friendly) — rather than a nested `Popover`: the FILE input already
 * lives inside a field-row `Popover` (`FieldInput`), and `file-input-field.tsx`'s
 * `FilePicker` is explicitly built to avoid Popover-in-Popover; `FileSelectDialog`
 * already proves Dialog-in-Popover is the safe nesting here, and `Sheet` is built on the
 * same Dialog primitive.
 */
export function PhotoTileEditor({
  trigger,
  name,
  caption,
  internal,
  onSave,
  onRemove,
}: PhotoTileEditorProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [captionDraft, setCaptionDraft] = useState(caption ?? '')
  const [internalDraft, setInternalDraft] = useState(internal ?? false)
  const [isSaving, setIsSaving] = useState(false)

  // Reset the draft from the freshest props every time the sheet opens.
  useEffect(() => {
    if (!open) return
    setCaptionDraft(caption ?? '')
    setInternalDraft(internal ?? false)
  }, [open, caption, internal])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const trimmed = captionDraft.trim()
      await onSave({ caption: trimmed ? trimmed : undefined, internal: internalDraft })
      setOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className='flex flex-col gap-4 sm:max-w-sm'>
        <SheetHeader>
          <SheetTitle className='truncate'>{name}</SheetTitle>
          <SheetDescription>Add a caption or hide this photo from the customer.</SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='photo-tile-caption'>Caption</Label>
          <Textarea
            id='photo-tile-caption'
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            placeholder='Add a caption…'
            rows={2}
          />
        </div>

        <div className='flex items-center justify-between rounded-md border p-3'>
          <div className='flex flex-col gap-0.5'>
            <span className='text-sm font-medium'>Internal</span>
            <span className='text-xs text-muted-foreground'>Hidden from customer</span>
          </div>
          <Switch checked={internalDraft} onCheckedChange={setInternalDraft} />
        </div>

        <SheetFooter className='mt-auto flex-row justify-between sm:justify-between'>
          <Button
            type='button'
            variant='destructive-hover'
            onClick={() => {
              setOpen(false)
              onRemove()
            }}>
            <Trash2 />
            Remove
          </Button>
          <Button type='button' loading={isSaving} loadingText='Saving...' onClick={handleSave}>
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
