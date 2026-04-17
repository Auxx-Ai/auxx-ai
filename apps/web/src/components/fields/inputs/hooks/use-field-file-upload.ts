// apps/web/src/components/fields/inputs/hooks/use-field-file-upload.ts
'use client'

import type { FileTypeCategory } from '@auxx/lib/files/client'
import { getMimePatternsForCategories } from '@auxx/lib/files/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { JsonFieldValue, TypedFieldValue } from '@auxx/types/field-value'
import { type FileRef, getFileRefDownloadUrl } from '@auxx/types/file-ref'
import { toastError } from '@auxx/ui/components/toast'
import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FileOptions } from '~/components/custom-fields/ui/file-options-editor'
import type { FileState } from '~/components/file-upload/stores'
import { useUploadStore } from '~/components/file-upload/stores'
import type { FileItem } from '~/components/files/files-store'
import {
  buildFieldValueKey,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { api } from '~/trpc/react'
import { vanillaApi } from '~/trpc/vanilla'

// =============================================================================
// MODULE-LEVEL INFRASTRUCTURE (survives React unmount)
// =============================================================================

interface CompletionHandler {
  recordId: string
  fieldRef: string
  storeKey: string
  allowMultiple: boolean
  registeredAt: number
}

/** Completion handlers keyed by uploaderId — persist across mount/unmount */
const completionHandlers = new Map<string, CompletionHandler>()

/** Uploaders currently being processed — prevents re-entrant firing */
const processingUploaders = new Set<string>()

/** Track whether we've already set up the global subscription */
let subscriptionActive = false

function initGlobalSubscription() {
  if (subscriptionActive) return
  subscriptionActive = true

  useUploadStore.subscribe((state) => {
    // Clean stale handlers (>30 min)
    const now = Date.now()
    for (const [id, handler] of completionHandlers) {
      if (now - handler.registeredAt > 30 * 60 * 1000) {
        completionHandlers.delete(id)
      }
    }

    if (completionHandlers.size === 0) return

    // Collect completed uploaders — do NOT call setState inside subscribe
    const completed: {
      uploaderId: string
      sessionId: string
      handler: CompletionHandler
      files: FileState[]
    }[] = []

    for (const [uploaderId, handler] of completionHandlers) {
      if (processingUploaders.has(uploaderId)) continue

      const sessionId = state.uploaderSessions?.[uploaderId]
      if (!sessionId) continue
      const session = state.sessions[sessionId]
      if (!session) continue

      const files = session.fileIds.map((id) => state.files[id]).filter(Boolean)
      if (files.length === 0) continue
      if (session.uploading) continue

      const allDone = files.every((f) => f.status === 'completed' || f.status === 'failed')
      if (!allDone) continue
      if (session.metadata?.__fieldNotifiedComplete) continue

      completed.push({ uploaderId, sessionId, handler, files })
    }

    // Process completions outside the subscription callback via microtask
    for (const { uploaderId, sessionId, handler, files } of completed) {
      processingUploaders.add(uploaderId)

      queueMicrotask(() => {
        // Mark notified AFTER exiting subscribe callback to avoid re-entrant setState
        useUploadStore.setState((s) => {
          const sess = s.sessions[sessionId]
          if (sess?.metadata) sess.metadata.__fieldNotifiedComplete = true
        })

        handleUploadCompletion(uploaderId, handler, files)
          .catch(console.error)
          .finally(() => processingUploaders.delete(uploaderId))
      })
    }
  })
}

// =============================================================================
// OPTIMISTIC AVATAR UPDATES
// =============================================================================

/**
 * Tracks in-flight avatar optimism so we can roll back on failure and revoke
 * blob URLs after the real URL lands. Keyed by uploaderId for native uploads,
 * and by a synthetic key for browse/delete flows.
 */
interface PendingAvatarState {
  recordId: string
  priorAvatarUrl: string | undefined
  blobUrl?: string
}
const pendingAvatarByKey = new Map<string, PendingAvatarState>()

/** Returns true if `fieldRef` is the avatar display field for this record's resource. */
function isAvatarField(recordId: string, fieldRef: string): boolean {
  try {
    const { entityDefinitionId } = parseRecordId(recordId as RecordId)
    const resource = useResourceStore.getState().getResourceById(entityDefinitionId)
    return resource?.display?.avatarField?.id === fieldRef
  } catch {
    return false
  }
}

/** Snapshot + optimistically write a new avatar URL. Returns a rollback closure. */
function optimisticallyWriteAvatar(
  recordId: string,
  newAvatarUrl: string | undefined
): { rollback: () => void; priorAvatarUrl: string | undefined } {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId as RecordId)
  const store = useRecordStore.getState()
  const current = store.records[entityDefinitionId]?.get(entityInstanceId)
  const priorAvatarUrl = current?.avatarUrl
  store.updateRecord(entityDefinitionId, entityInstanceId, { avatarUrl: newAvatarUrl })
  return {
    priorAvatarUrl,
    rollback: () => {
      useRecordStore
        .getState()
        .updateRecord(entityDefinitionId, entityInstanceId, { avatarUrl: priorAvatarUrl })
    },
  }
}

/** Schedule blob URL revocation — long enough for the <img> to swap to the new src. */
function scheduleBlobRevoke(blobUrl: string, delayMs = 10_000): void {
  setTimeout(() => {
    try {
      URL.revokeObjectURL(blobUrl)
    } catch {
      // no-op
    }
  }, delayMs)
}

/**
 * Shared write pipeline — used by both the native-upload completion handler
 * and the browse-dialog selection handler. Chooses the right backend call:
 *
 * - `allowMultiple: false` → `fieldValue.set` with a single-element array.
 *   Backend routes FILE through `setMultiValue`, which does DELETE+INSERT
 *   in a single transaction. Atomic replace, no orphan FieldValue rows.
 * - `allowMultiple: true`  → `fieldValue.add` per file (append semantics).
 *
 * Updates the local `useFieldValueStore` with the resulting TypedFieldValues
 * so UI reflects the change immediately.
 */
interface ApplyContext {
  recordId: string
  fieldRef: string
  storeKey: ReturnType<typeof buildFieldValueKey>
  allowMultiple: boolean
}

async function applyPendingFileRefs(ctx: ApplyContext, refs: string[]): Promise<void> {
  if (refs.length === 0) return

  const fvStore = useFieldValueStore.getState()

  if (!ctx.allowMultiple) {
    const [first] = refs
    if (!first) return
    const result = await vanillaApi.fieldValue.set.mutate({
      recordId: ctx.recordId,
      fieldId: ctx.fieldRef,
      value: [{ ref: first }],
    })
    // `fieldValue.set` → `setValueWithBuiltIn` → { state, performedAt, values }
    fvStore.setValue(ctx.storeKey, (result?.values ?? []) as TypedFieldValue[])
    return
  }

  const newTyped: TypedFieldValue[] = []
  for (const ref of refs) {
    const added = await vanillaApi.fieldValue.add.mutate({
      recordId: ctx.recordId,
      fieldId: ctx.fieldRef,
      fieldType: 'FILE',
      value: { type: 'json', value: { ref } },
    })
    newTyped.push(added as TypedFieldValue)
  }
  const current = fvStore.values[ctx.storeKey]
  const currentArr = Array.isArray(current) ? [...current] : current ? [current] : []
  fvStore.setValue(ctx.storeKey, [...currentArr, ...newTyped] as TypedFieldValue[])
}

async function handleUploadCompletion(
  uploaderId: string,
  handler: CompletionHandler,
  files: FileState[]
) {
  const successFiles = files.filter((f) => f.status === 'completed' && f.serverFileId)
  const pendingAvatar = pendingAvatarByKey.get(uploaderId)

  if (successFiles.length === 0) {
    // Upload failed entirely — rollback any optimistic avatar write and clean up.
    if (pendingAvatar) {
      useRecordStore
        .getState()
        .updateRecord(
          parseRecordId(pendingAvatar.recordId as RecordId).entityDefinitionId,
          parseRecordId(pendingAvatar.recordId as RecordId).entityInstanceId,
          { avatarUrl: pendingAvatar.priorAvatarUrl }
        )
      if (pendingAvatar.blobUrl) scheduleBlobRevoke(pendingAvatar.blobUrl, 0)
      pendingAvatarByKey.delete(uploaderId)
    }
    completionHandlers.delete(uploaderId)
    return
  }

  try {
    const filesToApply = handler.allowMultiple ? successFiles : [successFiles[0]!]
    const refs = filesToApply.map((f) => `asset:${f.serverFileId!}`)
    await applyPendingFileRefs(
      {
        recordId: handler.recordId,
        fieldRef: handler.fieldRef,
        storeKey: handler.storeKey as ReturnType<typeof buildFieldValueKey>,
        allowMultiple: handler.allowMultiple,
      },
      refs
    )

    // Field value saved — swap blob URL for a stable download URL so the image
    // keeps rendering even after the blob is revoked. The backend thumbnail
    // job will eventually overwrite this with the real 128px CDN URL via a
    // realtime record update.
    if (pendingAvatar && refs[0]) {
      const stableUrl = getFileRefDownloadUrl(refs[0] as FileRef)
      const { entityDefinitionId, entityInstanceId } = parseRecordId(
        pendingAvatar.recordId as RecordId
      )
      useRecordStore
        .getState()
        .updateRecord(entityDefinitionId, entityInstanceId, { avatarUrl: stableUrl })
      if (pendingAvatar.blobUrl) scheduleBlobRevoke(pendingAvatar.blobUrl)
    }
  } catch (error) {
    // Field value save failed — rollback avatar.
    if (pendingAvatar) {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(
        pendingAvatar.recordId as RecordId
      )
      useRecordStore.getState().updateRecord(entityDefinitionId, entityInstanceId, {
        avatarUrl: pendingAvatar.priorAvatarUrl,
      })
      if (pendingAvatar.blobUrl) scheduleBlobRevoke(pendingAvatar.blobUrl, 0)
    }
    toastError({
      title: 'Failed to attach uploaded files',
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    pendingAvatarByKey.delete(uploaderId)
    completionHandlers.delete(uploaderId)
  }
}

// =============================================================================
// TYPES
// =============================================================================

export interface UploadingFile {
  id: string
  name: string
  mimeType?: string | null
  progress?: number
  status: string
}

interface UseFieldFileUploadOptions {
  recordId: string
  fieldRef: string
  fileOptions: FileOptions
}

interface UseFieldFileUploadReturn {
  displayFiles: Array<{
    id: string // fieldValueId — for removal
    ref: FileRef
    name: string
    mimeType: string | null
    size: number | null
  }>
  uploadingFiles: UploadingFile[]
  isUploading: boolean
  /**
   * Whether the file picker can be opened. True for single-file fields even
   * when a value exists (upload replaces). For multi-file fields, false when
   * max files reached.
   */
  canAddMore: boolean
  /**
   * Strict slot-availability flag for multi-file UI that needs to distinguish
   * "at max, no more appends allowed" from "picker can open". Always false
   * for single-file fields (they replace, they don't append).
   */
  canAppend: boolean
  /**
   * Number of files the user can currently select in one picker interaction.
   * Multi-file: strict remaining slots. Single-file: always 1 (replaces
   * existing value).
   */
  remainingSlots: number
  openNativeFilePicker: () => void
  handleBrowseFilesSelected: (files: FileItem[]) => Promise<void>
  removeFile: (fieldValueId: string) => Promise<void>
  browseOpen: boolean
  setBrowseOpen: (open: boolean) => void
}

// Stable empty array references
const EMPTY_UPLOADING: UploadingFile[] = []
const EMPTY_ARRAY: TypedFieldValue[] = []

// =============================================================================
// HELPERS
// =============================================================================

/** Parse "asset:clx7abc" → { sourceType: 'asset', id: 'clx7abc' } */
function parseFileRef(ref: string): { sourceType: 'asset' | 'file'; id: string } {
  const colonIdx = ref.indexOf(':')
  return {
    sourceType: ref.slice(0, colonIdx) as 'asset' | 'file',
    id: ref.slice(colonIdx + 1),
  }
}

// =============================================================================
// HOOK
// =============================================================================

export function useFieldFileUpload({
  recordId,
  fieldRef,
  fileOptions,
}: UseFieldFileUploadOptions): UseFieldFileUploadReturn {
  const [browseOpen, setBrowseOpen] = useState(false)

  // Deterministic uploaderId — same across mount/unmount cycles
  const uploaderId = `field-upload:${recordId}:${fieldRef}`

  // Pre-compute store key
  const storeKey = useMemo(
    () => buildFieldValueKey(recordId as RecordId, fieldRef),
    [recordId, fieldRef]
  )

  // Initialize global subscription on first use
  useEffect(() => {
    initGlobalSubscription()
  }, [])

  // Clean up completion handler on unmount (only if not actively uploading)
  useEffect(() => {
    return () => {
      const state = useUploadStore.getState()
      const sessionId = state.uploaderSessions?.[uploaderId]
      const session = sessionId ? state.sessions[sessionId] : null
      if (!session?.uploading) {
        completionHandlers.delete(uploaderId)
      }
    }
  }, [uploaderId])

  // Subscribe to field value store for TypedFieldValue[] (with IDs)
  const typedValues = useFieldValueStore(
    useShallow((state) => {
      const val = state.values[storeKey]
      if (!val) return EMPTY_ARRAY
      return Array.isArray(val) ? (val as TypedFieldValue[]) : [val as TypedFieldValue]
    })
  )

  // Extract file refs from typed values
  const fileRefs = useMemo(
    () =>
      typedValues
        .filter((tv) => tv.type === 'json' && (tv as JsonFieldValue).value?.ref)
        .map((tv) => {
          const ref = (tv as JsonFieldValue).value.ref as string
          const { sourceType, id } = parseFileRef(ref)
          return { fieldValueId: tv.id, ref, sourceType, id }
        }),
    [typedValues]
  )

  // Fetch display details for all file refs
  const refs = useMemo(() => fileRefs.map((fr) => fr.ref), [fileRefs])
  const { data: fileDetails } = api.file.resolveFileRefs.useQuery(
    { refs },
    { enabled: refs.length > 0, placeholderData: keepPreviousData }
  )

  // Build display files by joining fileRefs with details
  const displayFiles = useMemo(() => {
    if (!fileDetails || fileRefs.length === 0) return []
    const detailMap = new Map(fileDetails.map((d) => [d.ref, d]))
    return fileRefs
      .map((fr) => {
        const detail = detailMap.get(fr.ref)
        return {
          id: fr.fieldValueId,
          ref: fr.ref as FileRef,
          name: detail?.name ?? 'Unknown file',
          mimeType: detail?.mimeType ?? null,
          size: detail?.size ?? null,
        }
      })
      .filter((f) => f.name !== 'Unknown file' || fileDetails.length < fileRefs.length)
  }, [fileRefs, fileDetails])

  // Set of asset IDs fully absorbed into displayFiles (store entry + resolved details).
  // Only mark as absorbed once fileDetails has the ref — prevents the upload entry
  // from disappearing before displayFiles can render it.
  const absorbedAssetIds = useMemo(() => {
    const ids = new Set<string>()
    if (!fileDetails) return ids
    const resolvedRefs = new Set(fileDetails.map((d) => d.ref))
    for (const fr of fileRefs) {
      if (fr.sourceType === 'asset' && resolvedRefs.has(fr.ref)) {
        ids.add(fr.id)
      }
    }
    return ids
  }, [fileRefs, fileDetails])

  // Select a stable fingerprint of active uploads — include completed files
  // that haven't been absorbed into displayFiles yet (prevents jump)
  const uploadFingerprint = useUploadStore((state) => {
    const sessionId = state.uploaderSessions?.[uploaderId]
    if (!sessionId) return ''
    const session = state.sessions[sessionId]
    if (!session) return ''

    const parts: string[] = []
    for (const id of session.fileIds) {
      const f = state.files[id]
      if (!f || f.status === 'failed') continue
      // Keep completed files in fingerprint until absorbed
      if (f.status === 'completed') {
        if (f.serverFileId && !absorbedAssetIds.has(f.serverFileId)) {
          parts.push(`${f.id}:settling`)
        }
        continue
      }
      parts.push(`${f.id}:${f.status}:${f.progress ?? 0}`)
    }
    return parts.join('|')
  })

  const uploadingFiles = useMemo(() => {
    if (!uploadFingerprint) return EMPTY_UPLOADING
    const state = useUploadStore.getState()
    const sessionId = state.uploaderSessions?.[uploaderId]
    if (!sessionId) return EMPTY_UPLOADING
    const session = state.sessions[sessionId]
    if (!session) return EMPTY_UPLOADING

    return session.fileIds
      .map((id) => state.files[id])
      .filter(Boolean)
      .filter((f) => {
        if (f.status === 'failed') return false
        // Keep completed files visible until displayFiles absorbs them
        if (f.status === 'completed') {
          return f.serverFileId ? !absorbedAssetIds.has(f.serverFileId) : false
        }
        return true
      })
      .map(
        (f): UploadingFile => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          progress: f.status === 'completed' ? 100 : f.progress,
          status: f.status,
        })
      )
  }, [uploadFingerprint, uploaderId, absorbedAssetIds])

  const isUploading = uploadingFiles.length > 0

  // Mutation for explicit remove flow (removeFile export)
  const removeValue = api.fieldValue.remove.useMutation()

  // Slot calculation.
  // - Multi-file: strict slot math based on maxFiles.
  // - Single-file: one conceptual slot, but it always "opens" because uploading
  //   replaces the existing value (atomic DELETE+INSERT via fieldValue.set).
  const maxFiles = fileOptions.allowMultiple
    ? (fileOptions.maxFiles ?? Number.POSITIVE_INFINITY)
    : 1
  const currentCount = typedValues.length + uploadingFiles.length
  const remainingSlots = Math.max(0, maxFiles - currentCount)
  const canAppend = fileOptions.allowMultiple && remainingSlots > 0
  const canOpenPicker = fileOptions.allowMultiple ? canAppend : true
  const canAddMore = canOpenPicker
  // Slots to pass to native input / browse dialog. Single-file mode always
  // allows 1 (replace); multi-file uses the strict remaining count.
  const effectiveSlots = fileOptions.allowMultiple ? remainingSlots : 1

  /**
   * Open native file picker. Registers completion handler BEFORE opening dialog.
   * For single-file fields, always opens — upload replaces any existing value.
   */
  const openNativeFilePicker = useCallback(async () => {
    if (!canOpenPicker) return

    try {
      // Create upload session in store
      const store = useUploadStore.getState()
      const sessionId = await store.createSessionWithGuard(uploaderId, {
        entityType: 'CUSTOM_FIELD',
        entityId: `field-${fieldRef}`,
        behaviorConfig: {
          allowMultiple: fileOptions.allowMultiple,
          autoStart: false,
        },
        metadata: { fieldId: fieldRef },
      })

      // Register or update completion handler (deduplicate)
      const existing = completionHandlers.get(uploaderId)
      if (!existing || Date.now() - existing.registeredAt >= 60_000) {
        completionHandlers.set(uploaderId, {
          recordId,
          fieldRef,
          storeKey,
          allowMultiple: fileOptions.allowMultiple,
          registeredAt: Date.now(),
        })
      }

      // Build accept string for file input
      const acceptTypes = fileOptions.allowedFileTypes
        ? getMimePatternsForCategories(fileOptions.allowedFileTypes as FileTypeCategory[]).join(',')
        : undefined

      // Create detached native file input (survives React unmount)
      const input = document.createElement('input')
      input.type = 'file'
      if (acceptTypes) input.accept = acceptTypes
      input.multiple = fileOptions.allowMultiple && effectiveSlots > 1
      input.style.display = 'none'
      document.body.appendChild(input)

      input.onchange = async () => {
        const files = Array.from(input.files ?? [])
        document.body.removeChild(input)

        if (files.length === 0) return

        // Optimistic avatar preview: show the locally-selected image instantly
        // via a blob URL. `handleUploadCompletion` swaps to a stable download
        // URL on server success, or rolls back on failure.
        if (isAvatarField(recordId, fieldRef) && files[0]) {
          const blobUrl = URL.createObjectURL(files[0])
          const { priorAvatarUrl } = optimisticallyWriteAvatar(recordId, blobUrl)
          pendingAvatarByKey.set(uploaderId, {
            recordId,
            priorAvatarUrl,
            blobUrl,
          })
        }

        try {
          const storeNow = useUploadStore.getState()
          const addResult = await storeNow.addFilesWithValidation(files, uploaderId, {
            maxFiles: effectiveSlots,
          })
          if (addResult.validationErrors.length > 0) {
            console.error('[useFieldFileUpload] validation errors:', addResult.validationErrors)
          }

          await storeNow.startUploadForSession(sessionId)
        } catch (err) {
          console.error('[useFieldFileUpload] upload error:', err)
          // Upload failed to start — rollback optimistic avatar.
          const pending = pendingAvatarByKey.get(uploaderId)
          if (pending) {
            const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId as RecordId)
            useRecordStore.getState().updateRecord(entityDefinitionId, entityInstanceId, {
              avatarUrl: pending.priorAvatarUrl,
            })
            if (pending.blobUrl) scheduleBlobRevoke(pending.blobUrl, 0)
            pendingAvatarByKey.delete(uploaderId)
          }
        }
      }

      input.click()
    } catch (error) {
      toastError({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [canOpenPicker, uploaderId, fieldRef, recordId, storeKey, effectiveSlots, fileOptions])

  /**
   * Handle files selected from FileSelectDialog. Routes through the shared
   * pipeline — single-file fields atomically replace, multi-file fields append.
   */
  const handleBrowseFilesSelected = useCallback(
    async (items: FileItem[]) => {
      if (items.length === 0) return

      const filesToApply = fileOptions.allowMultiple ? items : [items[0]!]
      const refs = filesToApply.map((item) => `file:${item.id}`)

      // Optimistic avatar preview — use the download URL immediately.
      let avatarRollback: (() => void) | null = null
      if (isAvatarField(recordId, fieldRef) && refs[0]) {
        const stableUrl = getFileRefDownloadUrl(refs[0] as FileRef)
        avatarRollback = optimisticallyWriteAvatar(recordId, stableUrl).rollback
      }

      try {
        await applyPendingFileRefs(
          {
            recordId,
            fieldRef,
            storeKey,
            allowMultiple: fileOptions.allowMultiple,
          },
          refs
        )
        setBrowseOpen(false)
      } catch (error) {
        avatarRollback?.()
        toastError({
          title: 'Failed to attach files',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [recordId, fieldRef, storeKey, fileOptions.allowMultiple]
  )

  /**
   * Remove a file by its FieldValue ID.
   */
  const removeFile = useCallback(
    async (fieldValueId: string) => {
      // Optimistic avatar clear — if this field is the avatar, clear the
      // cached record's avatarUrl so the UI updates instantly. Rolls back
      // on mutation failure.
      let avatarRollback: (() => void) | null = null
      if (isAvatarField(recordId, fieldRef)) {
        avatarRollback = optimisticallyWriteAvatar(recordId, undefined).rollback
      }

      try {
        await removeValue.mutateAsync({ valueId: fieldValueId })

        // Update store directly
        const fvStore = useFieldValueStore.getState()
        const current = fvStore.values[storeKey]
        const currentArr = Array.isArray(current) ? [...current] : current ? [current] : []
        const updated = (currentArr as TypedFieldValue[]).filter((tv) => tv.id !== fieldValueId)
        fvStore.setValue(storeKey, updated)
      } catch (error) {
        avatarRollback?.()
        toastError({
          title: 'Remove failed',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [removeValue, recordId, fieldRef, storeKey]
  )

  return {
    displayFiles,
    uploadingFiles,
    isUploading,
    canAddMore,
    canAppend,
    remainingSlots: effectiveSlots,
    openNativeFilePicker,
    handleBrowseFilesSelected,
    removeFile,
    browseOpen,
    setBrowseOpen,
  }
}
