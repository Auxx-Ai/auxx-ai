// apps/web/src/components/mail/composer-shared/use-composer-attachments.ts
'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import type { FileAttachment } from '../email-editor/types'

interface UseComposerAttachmentsOptions {
  /** Seed persisted attachments (email draft restore). Chat passes nothing. */
  initialAttachments?: FileAttachment[]
  /**
   * Pin the file-select entity id (email reuses the draft id). When omitted a
   * temp id is generated. The id is captured once at hook creation and stays
   * static — files uploaded before a draft exists associate via the temp id.
   */
  entityId?: string
  /**
   * Fired whenever attachments change or an upload completes / is removed —
   * email uses it to mark the draft dirty. Chat omits it (no-op).
   */
  onDirty?: () => void
}

interface UseComposerAttachmentsReturn {
  attachments: FileAttachment[]
  setAttachments: Dispatch<SetStateAction<FileAttachment[]>>
  fileSelect: ReturnType<typeof useFileSelect>
  /** Persisted attachments merged with ready files from fileSelect (deduped). */
  allAttachments: FileAttachment[]
  removeAttachment: (id: string) => void
  dropzone: Pick<ReturnType<typeof useDropzone>, 'getRootProps' | 'getInputProps' | 'isDragActive'>
}

/**
 * Shared attachment wiring for the composer surfaces: persisted-attachment
 * state, the file-select upload hook, the dropzone, the merge of persisted +
 * in-progress files, and the remove handler.
 */
export function useComposerAttachments(
  options: UseComposerAttachmentsOptions = {}
): UseComposerAttachmentsReturn {
  const { initialAttachments, entityId, onDirty } = options

  const [attachments, setAttachments] = useState<FileAttachment[]>(() => initialAttachments ?? [])

  // Entity id is captured once and stays static for the life of the hook.
  const [resolvedEntityId] = useState(
    () => entityId ?? `temp-message-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  )

  const fileSelect = useFileSelect({
    entityType: 'MESSAGE',
    entityId: resolvedEntityId,
    allowMultiple: true,
    maxFiles: 10,
    maxFileSize: 25 * 1024 * 1024, // 25MB
    autoStart: true,
    onChange: onDirty,
    onUploadComplete: onDirty,
  })

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => fileSelect.addFiles(acceptedFiles),
    noClick: true, // editor handles clicks
    noKeyboard: true,
  })

  // Combine persisted attachments + files from select that are ready to save:
  // existing filesystem files (id is the server file id) and completed uploads
  // (use serverFileId). Dedupe against persisted ids.
  const allAttachments = useMemo(() => {
    const filesFromSelect: FileAttachment[] = fileSelect.selectedItems
      .filter((item) => item.source === 'filesystem' || item.serverFileId)
      .map((item) => ({
        id: item.source === 'filesystem' ? item.id : item.serverFileId!,
        name: item.name,
        size: Number(item.size ?? 0),
        mimeType: item.mimeType || 'application/octet-stream',
        type: 'file' as const,
      }))
    const existingIds = new Set(attachments.map((a) => a.id))
    return [...attachments, ...filesFromSelect.filter((f) => !existingIds.has(f.id))]
  }, [attachments, fileSelect.selectedItems])

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id))
      onDirty?.()
    },
    [onDirty]
  )

  return {
    attachments,
    setAttachments,
    fileSelect,
    allAttachments,
    removeAttachment,
    dropzone: { getRootProps, getInputProps, isDragActive },
  }
}
