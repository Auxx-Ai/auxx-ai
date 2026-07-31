// apps/web/src/components/mail/composer-shared/attachment-strip.tsx
'use client'

import type { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import { MessageFile } from '../email-editor/message-file'
import type { FileAttachment } from '../email-editor/types'

interface AttachmentStripProps {
  /** Persisted attachments (e.g. from a restored draft). */
  attachments: FileAttachment[]
  /** In-progress / completed uploads from the file-select hook. */
  selectedItems: ReturnType<typeof useFileSelect>['selectedItems']
  onRemoveAttachment: (id: string) => void
  onRemoveUpload: (id: string) => void
}

/**
 * The "Attachments (N)" block shared by the email and chat composers — renders
 * persisted attachments plus in-progress uploads. Renders nothing when empty.
 */
export function AttachmentStrip({
  attachments,
  selectedItems,
  onRemoveAttachment,
  onRemoveUpload,
}: AttachmentStripProps) {
  if (attachments.length === 0 && selectedItems.length === 0) return null

  return (
    <div className='mx-4 mb-3 mt-2'>
      <div className='text-xs text-muted-foreground mb-2'>
        Attachments ({attachments.length + selectedItems.length})
      </div>
      <div className='flex flex-wrap gap-2'>
        {/* Persisted attachments */}
        {attachments.map((attachment) => (
          <MessageFile
            key={attachment.id}
            file={{
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              size: attachment.size || 0,
              source: 'existing' as const,
            }}
            showRemoveButton={true}
            onRemove={() => onRemoveAttachment(attachment.id)}
            className='group'
          />
        ))}
        {/* In-progress uploads */}
        {selectedItems.map((file) => (
          <MessageFile
            key={file.id}
            file={{
              id: file.id,
              name: file.name,
              mimeType: file.mimeType ?? undefined,
              size: file.size ?? undefined,
              source: 'upload' as const,
            }}
            showRemoveButton={true}
            onRemove={() => onRemoveUpload(file.id)}
            className='group'
          />
        ))}
      </div>
    </div>
  )
}
