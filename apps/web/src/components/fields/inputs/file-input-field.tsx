// apps/web/src/components/fields/inputs/file-input-field.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Paperclip } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import type { FileItem } from '~/components/files/files-store'
import { CommentFile } from '~/components/global/comments/comment-file'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { api } from '~/trpc/react'
import { usePropertyContext } from '../property-provider'

/**
 * FileInputField component for file custom fields
 * Allows users to upload new files or select existing files from library
 *
 * Pattern C: Selection picker (for file selection)
 * - Uses commitValueAsync for async file operations that need the value ID
 * - File uploads require awaiting the response to get attachment IDs
 * - CAPTURES arrow keys (if we add list navigation later)
 */
export function FileInputField() {
  const { value, commitValueAsync, field } = usePropertyContext()
  const [pickerOpen, setPickerOpen] = useState(false)

  // value structure: { attachmentIds: string[] | string }
  const attachmentIds = Array.isArray(value?.attachmentIds)
    ? value.attachmentIds
    : value?.attachmentIds
      ? [value.attachmentIds]
      : []

  // Get field options for allowMultiple
  const allowMultiple = field?.options?.allowMultiple ?? false

  // Fetch attachment details
  const { data: attachments } = api.attachment.getByIds.useQuery(
    { ids: attachmentIds },
    { enabled: attachmentIds.length > 0 }
  )

  // Extract already-attached file/asset IDs for deduplication
  const attachedFileIds = useMemo(() => {
    if (!attachments) return new Set<string>()
    return new Set(attachments.map((a) => a.fileId || a.assetId).filter((id): id is string => !!id))
  }, [attachments])

  // File mutations
  const createAttachment = api.attachment.createForCustomField.useMutation()
  const removeAttachment = api.attachment.removeFromCustomField.useMutation()

  // Stable entityId across re-renders (prevents session churn)
  const entityId = useMemo(() => `temp-custom-field-${crypto.randomUUID()}`, [])

  /**
   * Ensure CustomFieldValue exists and return its ID.
   * Creates one with empty value if it doesn't exist yet.
   */
  const ensureValueId = useCallback(async (): Promise<string> => {
    if (field.valueId) return field.valueId

    const result = await commitValueAsync({})

    if (!result?.id) {
      throw new Error('Failed to create CustomFieldValue - no ID returned')
    }

    return result.id
  }, [field.valueId, commitValueAsync])

  /**
   * Create attachments for files/assets (with deduplication)
   */
  const attachAssets = useCallback(
    async (
      valueId: string,
      items: Array<{ id: string; type: 'file' | 'asset' }>
    ): Promise<string[]> => {
      // Dedupe: skip files/assets that are already attached
      const deduped = items.filter((item) => !attachedFileIds.has(item.id))

      if (deduped.length === 0) {
        return []
      }

      const results = await Promise.all(
        deduped.map((item) =>
          createAttachment.mutateAsync({
            customFieldValueId: valueId,
            fileId: item.type === 'file' ? item.id : undefined,
            assetId: item.type === 'asset' ? item.id : undefined,
            role: 'ATTACHMENT',
          })
        )
      )

      return results.map((r) => r.id)
    },
    [attachedFileIds, createAttachment]
  )

  /**
   * Save attachment IDs to CustomFieldValue
   */
  const saveAttachments = useCallback(
    async (newIds: string[]) => {
      const merged = allowMultiple ? [...attachmentIds, ...newIds] : newIds

      const updatedValue = {
        attachmentIds: allowMultiple ? merged : (merged[0] ?? null),
      }

      await commitValueAsync(updatedValue)
    },
    [attachmentIds, allowMultiple, commitValueAsync]
  )

  /**
   * Handler for new file uploads
   */
  const handleUploadComplete = useCallback(
    async (items: FileItem[]) => {
      try {
        const valueId = await ensureValueId()

        // Uploaded files are MediaAssets - use 'asset' type
        const uploadItems = items
          .map((i) => ({
            id: i.serverFileId!,
            type: 'asset' as const,
          }))
          .filter((item) => item.id)

        const newIds = await attachAssets(valueId, uploadItems)

        if (newIds.length > 0) {
          await saveAttachments(newIds)
        }

        setPickerOpen(false)
      } catch (error: any) {
        console.error('[FileInputField] Error saving uploaded files:', error)
        toastError({
          title: 'Upload failed',
          description: error.message || 'Could not save uploaded files',
        })
      }
    },
    [ensureValueId, attachAssets, saveAttachments]
  )

  /**
   * Handler for existing file selection
   */
  const handleExistingFilesAdded = useCallback(
    async (items: FileItem[]) => {
      try {
        const valueId = await ensureValueId()

        // Existing files from library are FolderFiles - use 'file' type
        const fileItems = items
          .map((i) => ({
            id: i.id,
            type: 'file' as const,
          }))
          .filter((item) => item.id)

        const newIds = await attachAssets(valueId, fileItems)

        if (newIds.length > 0) {
          await saveAttachments(newIds)
        }

        setPickerOpen(false)
      } catch (error: any) {
        console.error('[FileInputField] Error attaching existing files:', error)
        toastError({
          title: 'Attachment failed',
          description: error.message || 'Could not attach selected files',
        })
      }
    },
    [ensureValueId, attachAssets, saveAttachments]
  )

  // File selection hook
  const fileSelect = useFileSelect({
    allowMultiple,
    entityType: 'COMMENT',
    entityId: `temp-comment-${entityId}`,
    autoStart: true,
    onUploadComplete: handleUploadComplete,
    onExistingFilesAdded: handleExistingFilesAdded,
  })

  /**
   * Handle removing an attachment
   */
  const handleRemove = async (attachmentId: string) => {
    try {
      await removeAttachment.mutateAsync({
        attachmentId,
      })

      const remaining = attachmentIds.filter((id) => id !== attachmentId)
      await commitValueAsync({
        attachmentIds: allowMultiple ? remaining : remaining[0] || null,
      })
    } catch (error) {
      console.error('Error removing attachment:', error)
      toastError({
        title: 'Remove failed',
        description: 'Could not remove attachment',
      })
    }
  }

  return (
    <div className='space-y-2 py-0.5 px-0.5'>
      {attachments?.map((attachment) => (
        <div key={attachment.id} className='group'>
          <CommentFile
            file={attachment.asset}
            showRemoveButton={true}
            onRemove={() => handleRemove(attachment.id)}
          />
        </div>
      ))}

      <FileSelectPicker
        fileSelect={fileSelect}
        allowMultiple={allowMultiple}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        align='end'
        className='w-80'>
        <div className='w-full flex justify-between items-center'>
          <span className='text-xs text-muted-foreground/80 ps-3 cursor-pointer'>Add files...</span>
          <Button
            variant='ghost'
            size='icon'
            className='flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/80 outline-hidden transition-[color,box-shadow] hover:bg-gray-300 hover:text-foreground dark:hover:bg-gray-700'>
            <Paperclip size={15} />
          </Button>
        </div>
      </FileSelectPicker>
    </div>
  )
}
