// apps/web/src/components/returns/intake/hooks/use-label-upload.ts
'use client'

// Push N photographed return labels through the existing CUSTOM_FIELD temp-upload
// door and hand back one `asset:<mediaAssetId>` FileRef per label, which is what
// `returnIntake.start` takes (plans/money/tasks/57 §1.2, §7.2).
//
// 🛑 There is NO new `EntityType`. `files/upload/handlers/custom-field.ts` already
// takes uploads aimed at a field value that does not exist yet, via
// `TEMP_FIELD_PREFIX = 'field-'` on a 24-hour `TEMP_ASSET_TTL_MS`, and
// `return.photos` is already `allowMultiple`. A label photographed before the
// return exists is exactly what that door is for, and commit links it.
//
// 🛑 The `fieldRef` is the REAL `return.photos` field id, not a synthetic string.
// The door narrows accepted MIME types from the field's own options and stamps
// `metadata.fieldId` onto the upload; a made-up ref resolves to no field, so the
// narrowing silently does not apply.
//
// ⚠️ Unlike `use-quote-upload.ts` this is a BATCH, and the difference is the whole
// point: a dock worker drops ten photos and one is a thumb over the lens. Each
// file reports its own outcome, so one bad photo costs the other nine nothing —
// the caller starts the read with the refs it got and shows the failures beside
// them.
//
// ⚠️ Nothing here writes a FIELD VALUE. The draft is not a record yet; the assets
// are linked into `return.photos` only by the commit, which is also where they
// stop being `TEMP_UPLOAD`s on a 24-hour fuse.

import { RETURN_INTAKE_MAX_LABELS, RETURN_LABEL_EXTENSIONS } from '@auxx/lib/returns/intake/client'
import { useCallback, useId, useRef, useState } from 'react'
import type { FileState } from '~/components/file-upload/stores'
import { useUploadStore } from '~/components/file-upload/stores'

/** One photo's outcome. Exactly one of `fileRef` / `error` is set. */
export interface LabelUploadResult {
  fileName: string
  /** `asset:<mediaAssetId>` — what `returnIntake.start` takes per label. */
  fileRef: string | null
  mimeType: string | null
  size: number | null
  /** Why this one photo did not land. Never fails the batch. */
  error: string | null
}

interface UseLabelUploadOptions {
  /** The `return.photos` field id. Empty until the resource store loads. */
  fieldRef: string
}

/** Per-file percentage while the batch is in flight, keyed by file name. */
export type LabelUploadProgress = Record<string, number>

/**
 * Upload a batch of label photos, awaited end to end.
 *
 * `startUpload` resolves with the run's own `BatchUploadResult`, so this needs
 * neither `onUploaderSettled` nor a persistent store subscription for the
 * result — the dialog stays mounted for the whole run. The transient
 * subscription that does exist is only there to drive the per-file bars.
 */
export function useLabelUpload({ fieldRef }: UseLabelUploadOptions) {
  const uploaderId = useId()
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState<LabelUploadProgress>({})
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const upload = useCallback(
    async (files: File[]): Promise<LabelUploadResult[]> => {
      if (!fieldRef) {
        throw new Error('Returns have no photos field in this organization yet.')
      }
      if (files.length === 0) return []

      setIsUploading(true)
      setProgress({})

      try {
        const sessionId = await useUploadStore.getState().createSessionWithGuard(uploaderId, {
          entityType: 'CUSTOM_FIELD',
          entityId: `field-${fieldRef}`,
          behaviorConfig: { allowMultiple: true, autoStart: false },
          metadata: { fieldId: fieldRef },
        })

        const added = await useUploadStore.getState().addFilesWithValidation(files, uploaderId, {
          maxFiles: RETURN_INTAKE_MAX_LABELS,
          fileExtensions: [...RETURN_LABEL_EXTENSIONS],
          sessionId,
        })

        const queuedIds = added.addedFileIds
        if (queuedIds.length === 0) {
          // Nothing was queued at all: report the refusal against every photo
          // rather than throwing, so the dialog can keep the list on screen.
          const reason = added.validationErrors[0] ?? 'Those files could not be uploaded.'
          return files.map((file) => ({
            fileName: file.name,
            fileRef: null,
            mimeType: null,
            size: file.size,
            error: reason,
          }))
        }

        // Per-file bars, for as long as the run lasts. A plain subscribe (no
        // selector middleware on this store) is enough; it is torn down in
        // `finally` so a settled batch stops writing state into an open dialog.
        unsubscribeRef.current?.()
        unsubscribeRef.current = useUploadStore.subscribe((state) => {
          const next: LabelUploadProgress = {}
          for (const id of queuedIds) {
            const f = state.files[id]
            if (f) next[f.name] = f.progress ?? 0
          }
          setProgress(next)
        })

        await useUploadStore.getState().startUpload(sessionId)

        const settled = useUploadStore.getState()
        const byName = new Map<string, FileState>()
        for (const id of queuedIds) {
          const f = settled.files[id]
          if (f) byName.set(f.name, f)
        }

        const results: LabelUploadResult[] = files.map((file) => {
          const state = byName.get(file.name)
          if (!state) {
            return {
              fileName: file.name,
              fileRef: null,
              mimeType: file.type || null,
              size: file.size,
              error: added.validationErrors[0] ?? 'That file could not be uploaded.',
            }
          }
          if (state.status !== 'completed' || !state.serverFileId) {
            return {
              fileName: file.name,
              fileRef: null,
              mimeType: state.mimeType ?? null,
              size: state.size ?? null,
              error: state.error ?? 'The upload did not complete.',
            }
          }
          return {
            fileName: state.name,
            fileRef: `asset:${state.serverFileId}`,
            mimeType: state.mimeType ?? null,
            size: state.size ?? null,
            error: null,
          }
        })

        // Release the store rows now the refs are in hand — the draft owns the
        // assets from here, and settled rows left in the queue show up in every
        // other uploader surface on the page.
        useUploadStore.getState().removeFiles(queuedIds)

        return results
      } finally {
        unsubscribeRef.current?.()
        unsubscribeRef.current = null
        setIsUploading(false)
      }
    },
    [fieldRef, uploaderId]
  )

  const cancel = useCallback(() => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    useUploadStore.getState().cleanupUploader(uploaderId)
  }, [uploaderId])

  return { upload, cancel, isUploading, progress }
}
