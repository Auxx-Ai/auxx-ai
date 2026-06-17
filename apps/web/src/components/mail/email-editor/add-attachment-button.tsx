// apps/web/src/components/mail/email-editor/add-attachment-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Paperclip } from 'lucide-react'
import type { UseFileSelectReturn } from '~/components/file-select/types'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { useEditorActiveStateContext } from './editor-active-state-context'

/**
 * "Add attachment" trigger for the composer action row. Wraps the shared
 * {@link FileSelectPicker} with a ghost/xs trigger styled like the sibling
 * "Add action" / "Add signature" buttons, and mirrors the popover-open tracking
 * the old toolbar File icon did (so the editor stays "active" while open).
 */
export function AddAttachmentButton({
  fileSelect,
  disabled,
  popoverClassName,
}: {
  fileSelect: UseFileSelectReturn
  disabled?: boolean
  popoverClassName?: string
}) {
  const { trackPopoverOpen, trackPopoverClose } = useEditorActiveStateContext()

  return (
    <FileSelectPicker
      fileSelect={fileSelect}
      align='start'
      side='top'
      showPath={false}
      className={cn('w-70', popoverClassName)}
      onOpenChange={(open) =>
        open ? trackPopoverOpen('file-select-picker') : trackPopoverClose('file-select-picker')
      }>
      <Button
        variant='ghost'
        size='xs'
        disabled={disabled}
        className='h-6 gap-1 text-xs text-muted-foreground/50'>
        <Paperclip className='size-3' />
        Add attachment
      </Button>
    </FileSelectPicker>
  )
}
