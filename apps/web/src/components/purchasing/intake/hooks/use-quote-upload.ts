// apps/web/src/components/purchasing/intake/hooks/use-quote-upload.ts
'use client'

// Push one purchasing document through the existing CUSTOM_FIELD temp-upload
// door and hand back the `asset:<mediaAssetId>` FileRef that an intake start
// procedure takes
// (plans/money/tasks/38 §1.3 / §6.2).
//
// 🛑 The `fieldRef` is the REAL owning document field id, not a synthetic string.
// The door narrows accepted MIME types from the field's own
// options and stamps `metadata.fieldId` onto the upload; a made-up ref resolves
// to no field, so the narrowing silently does not apply and a person can upload
// something the transcriber then refuses to read.
//
// ⚠️ Unlike `useFieldFileUpload`, nothing here writes a FIELD VALUE. The draft
// or intake run owns the asset and converts it from a `TEMP_UPLOAD` after its
// own commit path succeeds.

import { useCallback, useId, useState } from 'react'
import type { FileState } from '~/components/file-upload/stores'
import { useUploadStore } from '~/components/file-upload/stores'

export interface DocumentUploadResult {
  /** `asset:<mediaAssetId>` — what an intake start procedure takes as `assetRef`. */
  assetRef: string
  fileName: string
  mimeType: string | null
  size: number | null
}

interface UseDocumentUploadOptions {
  /** The owning document field id. Empty until the resource loads. */
  fieldRef: string
}

/**
 * One-file upload, awaited end to end.
 *
 * `startUpload` resolves with the run's own `BatchUploadResult`, so this needs
 * neither `onUploaderSettled` nor a store subscription — the field hook only
 * reaches for those because a field's popover can unmount mid-upload and the
 * value still has to land. Here the dialog stays mounted for the whole run and
 * the caller wants the ref back.
 */
export function useDocumentUpload({ fieldRef }: UseDocumentUploadOptions) {
  const uploaderId = useId()
  const [isUploading, setIsUploading] = useState(false)

  const upload = useCallback(
    async (file: File): Promise<DocumentUploadResult> => {
      if (!fieldRef) {
        throw new Error('The document upload field is not available in this organization yet.')
      }
      setIsUploading(true)

      try {
        const store = useUploadStore.getState()
        const sessionId = await store.createSessionWithGuard(uploaderId, {
          entityType: 'CUSTOM_FIELD',
          entityId: `field-${fieldRef}`,
          behaviorConfig: { allowMultiple: false, autoStart: false },
          metadata: { fieldId: fieldRef },
        })

        const added = await useUploadStore
          .getState()
          .addFilesWithValidation([file], uploaderId, { maxFiles: 1, sessionId })

        if (added.addedFileIds.length === 0) {
          throw new Error(added.validationErrors[0] ?? 'That file could not be uploaded.')
        }

        const result = await useUploadStore.getState().startUpload(sessionId)

        const runFileIds = result.results
          .map((r) => r.fileId)
          .filter((id): id is string => id !== undefined)
        const settled = useUploadStore.getState()
        const uploaded = runFileIds
          .map((id) => settled.files[id])
          .find(
            (f): f is FileState =>
              f !== undefined && f.status === 'completed' && Boolean(f.serverFileId)
          )

        if (!uploaded?.serverFileId) {
          const failed = runFileIds
            .map((id) => settled.files[id])
            .find((f) => f?.error !== undefined)
          throw new Error(failed?.error ?? 'The upload did not complete.')
        }

        // Release the store rows now that the ref is in hand — the draft owns the
        // asset from here, and a settled row left in the queue shows up in every
        // other uploader surface on the page.
        useUploadStore.getState().removeFiles(runFileIds)

        return {
          assetRef: `asset:${uploaded.serverFileId}`,
          fileName: uploaded.name,
          mimeType: uploaded.mimeType ?? null,
          size: uploaded.size ?? null,
        }
      } finally {
        setIsUploading(false)
      }
    },
    [fieldRef, uploaderId]
  )

  const cancel = useCallback(() => {
    useUploadStore.getState().cleanupUploader(uploaderId)
  }, [uploaderId])

  return { upload, cancel, isUploading }
}

/** Backwards-compatible name used by the purchase-order quote intake dialog. */
export const useQuoteUpload = useDocumentUpload
