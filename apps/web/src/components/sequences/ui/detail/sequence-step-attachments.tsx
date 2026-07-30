// apps/web/src/components/sequences/ui/detail/sequence-step-attachments.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Paperclip } from 'lucide-react'
import { useMemo } from 'react'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import type { FileItem } from '~/components/files/files-store'
import { MessageFile } from '~/components/mail/email-editor/message-file'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { useFileRefs } from '~/components/resources'

interface SequenceStepAttachmentsProps {
  stepId: string
  attachmentIds: string[]
  /** Persist a new attachment id list (autosaved upstream). */
  onAttachmentIdsChange: (ids: string[]) => void
}

/**
 * Per-step attachment chips + an "Attach files" picker, reusing the mail
 * composer's upload path (`useFileSelect` with the MESSAGE entity config +
 * `FileSelectPicker` for upload / browse-library). Persisted ids resolve their
 * display names via the batched `useFileRefs` store; a fresh upload's name comes from
 * the in-flight file-select item until it lands in the persisted list.
 */
export function SequenceStepAttachments({
  stepId,
  attachmentIds,
  onAttachmentIdsChange,
}: SequenceStepAttachmentsProps) {
  const fileSelect = useFileSelect({
    entityType: 'MESSAGE',
    entityId: stepId,
    allowMultiple: true,
    maxFiles: 10,
    maxFileSize: 25 * 1024 * 1024, // 25MB — mail composer parity
    autoStart: true,
    onUploadComplete: (items) => {
      const newIds = items
        .map((item) => item.serverFileId ?? item.id)
        .filter((id) => !attachmentIds.includes(id))
      if (newIds.length > 0) onAttachmentIdsChange([...attachmentIds, ...newIds])
    },
    onExistingFilesAdded: (items) => {
      const newIds = items.map((item) => item.id).filter((id) => !attachmentIds.includes(id))
      if (newIds.length > 0) onAttachmentIdsChange([...attachmentIds, ...newIds])
    },
  })

  // Resolve persisted ids → names. Ids can be library file ids or upload asset
  // ids, so probe both ref forms and use whichever the server resolves.
  const refs = useMemo(
    () => attachmentIds.flatMap((id) => [`file:${id}`, `asset:${id}`]),
    [attachmentIds]
  )
  const { details } = useFileRefs(refs)
  const metaById = useMemo(() => {
    const map = new Map<string, { name: string; mimeType: string | null; size: number | null }>()
    for (const entry of details) {
      const id = entry.ref.slice(entry.ref.indexOf(':') + 1)
      if (!map.has(id)) map.set(id, entry)
    }
    return map
  }, [details])

  // Session names for ids the resolver hasn't caught up with yet.
  const sessionNameById = useMemo(() => {
    const map = new Map<string, FileItem>()
    for (const item of fileSelect.selectedItems) {
      map.set(item.serverFileId ?? item.id, item)
    }
    return map
  }, [fileSelect.selectedItems])

  const inProgress = fileSelect.selectedItems.filter(
    (item) => item.source === 'upload' && item.status !== 'completed'
  )

  const removeAttachment = (id: string) => {
    onAttachmentIdsChange(attachmentIds.filter((a) => a !== id))
  }

  return (
    <div className='flex flex-col gap-2'>
      {(attachmentIds.length > 0 || inProgress.length > 0) && (
        <div className='flex flex-wrap gap-2'>
          {attachmentIds.map((id) => {
            const meta = metaById.get(id)
            const session = sessionNameById.get(id)
            return (
              <MessageFile
                key={id}
                file={{
                  id,
                  name: meta?.name ?? session?.name ?? 'Attachment',
                  mimeType: meta?.mimeType ?? session?.mimeType ?? undefined,
                  size: BigInt(meta?.size ?? Number(session?.size ?? 0)),
                  source: 'existing',
                }}
                showRemoveButton
                onRemove={() => removeAttachment(id)}
                className='group'
              />
            )
          })}
          {inProgress.map((item) => (
            <MessageFile
              key={item.id}
              file={{
                id: item.id,
                name: item.name,
                mimeType: item.mimeType ?? undefined,
                size: item.size ?? undefined,
                source: 'upload',
              }}
              showRemoveButton
              onRemove={() => fileSelect.removeItem(item.id)}
              className='group'
            />
          ))}
        </div>
      )}

      <div>
        <FileSelectPicker fileSelect={fileSelect} align='start' side='bottom'>
          <Button variant='ghost' size='xs' className='text-muted-foreground'>
            <Paperclip />
            Attach files
          </Button>
        </FileSelectPicker>
      </div>
    </div>
  )
}
