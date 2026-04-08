// apps/web/src/components/fields/inputs/hooks/use-field-file-upload.ts
'use client'

import type { FileTypeCategory } from '@auxx/lib/files/client'
import { getMimePatternsForCategories } from '@auxx/lib/files/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { JsonFieldValue, TypedFieldValue } from '@auxx/types/field-value'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FileOptions } from '~/components/custom-fields/ui/file-options-editor'
import type { FileState } from '~/components/file-upload/stores'
import { useUploadStore } from '~/components/file-upload/stores'
import type { FileItem } from '~/components/files/files-store'
import {
  buildFieldValueKey,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
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

async function handleUploadCompletion(
  uploaderId: string,
  handler: CompletionHandler,
  files: FileState[]
) {
  const successFiles = files.filter((f) => f.status === 'completed' && f.serverFileId)

  if (successFiles.length === 0) {
    completionHandlers.delete(uploaderId)
    return
  }

  try {
    const filesToAdd = handler.allowMultiple ? successFiles : [successFiles[0]!]
    const newTypedValues: TypedFieldValue[] = []

    for (const file of filesToAdd) {
      const result = await vanillaApi.fieldValue.add.mutate({
        recordId: handler.recordId,
        fieldId: handler.fieldRef,
        fieldType: 'FILE',
        value: { type: 'json', value: { ref: `asset:${file.serverFileId!}` } },
      })
      newTypedValues.push(result as TypedFieldValue)
    }

    // Update store directly for immediate UI refresh
    const store = useFieldValueStore.getState()
    const current = store.values[handler.storeKey as ReturnType<typeof buildFieldValueKey>]
    const currentArray = Array.isArray(current) ? [...current] : current ? [current] : []

    if (handler.allowMultiple) {
      store.setValue(
        handler.storeKey as ReturnType<typeof buildFieldValueKey>,
        [...currentArray, ...newTypedValues] as TypedFieldValue[]
      )
    } else {
      store.setValue(handler.storeKey as ReturnType<typeof buildFieldValueKey>, newTypedValues)
    }
  } catch (error) {
    toastError({
      title: 'Failed to attach uploaded files',
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
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
    name: string
    mimeType: string | null
    size: number | null
  }>
  uploadingFiles: UploadingFile[]
  isUploading: boolean
  canAddMore: boolean
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
    { enabled: refs.length > 0 }
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

  // Mutations for browse + remove flows
  const addValue = api.fieldValue.add.useMutation()
  const removeValue = api.fieldValue.remove.useMutation()

  // Calculate slots
  const maxFiles = fileOptions.allowMultiple
    ? (fileOptions.maxFiles ?? Number.POSITIVE_INFINITY)
    : 1
  const currentCount = typedValues.length + uploadingFiles.length
  const remainingSlots = Math.max(0, maxFiles - currentCount)
  const canAddMore = remainingSlots > 0

  // Keep refs for module-level handler
  const typedValuesRef = useRef(typedValues)
  typedValuesRef.current = typedValues

  /**
   * Open native file picker. Registers completion handler BEFORE opening dialog.
   */
  const openNativeFilePicker = useCallback(async () => {
    if (!canAddMore) return

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
      input.multiple = fileOptions.allowMultiple && remainingSlots > 1
      input.style.display = 'none'
      document.body.appendChild(input)

      input.onchange = async () => {
        const files = Array.from(input.files ?? [])
        document.body.removeChild(input)

        if (files.length === 0) return

        try {
          const storeNow = useUploadStore.getState()
          const addResult = await storeNow.addFilesWithValidation(files, uploaderId, {
            maxFiles: remainingSlots,
          })
          if (addResult.validationErrors.length > 0) {
            console.error('[useFieldFileUpload] validation errors:', addResult.validationErrors)
          }

          await storeNow.startUploadForSession(sessionId)
        } catch (err) {
          console.error('[useFieldFileUpload] upload error:', err)
        }
      }

      input.click()
    } catch (error) {
      toastError({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [canAddMore, uploaderId, fieldRef, recordId, storeKey, remainingSlots, fileOptions])

  /**
   * Handle files selected from FileSelectDialog.
   */
  const handleBrowseFilesSelected = useCallback(
    async (items: FileItem[]) => {
      if (items.length === 0) return

      try {
        const newTypedValues: TypedFieldValue[] = []

        // For single file mode, remove existing files first
        if (!fileOptions.allowMultiple && typedValuesRef.current.length > 0) {
          for (const tv of typedValuesRef.current) {
            await removeValue.mutateAsync({ valueId: tv.id })
          }
        }

        const filesToAdd = fileOptions.allowMultiple ? items : [items[0]!]
        for (const item of filesToAdd) {
          const result = await addValue.mutateAsync({
            recordId,
            fieldId: fieldRef,
            fieldType: 'FILE',
            value: { type: 'json', value: { ref: `file:${item.id}` } },
          })
          newTypedValues.push(result as TypedFieldValue)
        }

        // Update store directly
        const fvStore = useFieldValueStore.getState()
        if (fileOptions.allowMultiple) {
          const current = fvStore.values[storeKey]
          const currentArr = Array.isArray(current) ? [...current] : current ? [current] : []
          fvStore.setValue(storeKey, [...currentArr, ...newTypedValues] as TypedFieldValue[])
        } else {
          fvStore.setValue(storeKey, newTypedValues)
        }

        setBrowseOpen(false)
      } catch (error) {
        toastError({
          title: 'Failed to attach files',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [recordId, fieldRef, storeKey, fileOptions.allowMultiple, addValue, removeValue]
  )

  /**
   * Remove a file by its FieldValue ID.
   */
  const removeFile = useCallback(
    async (fieldValueId: string) => {
      try {
        await removeValue.mutateAsync({ valueId: fieldValueId })

        // Update store directly
        const fvStore = useFieldValueStore.getState()
        const current = fvStore.values[storeKey]
        const currentArr = Array.isArray(current) ? [...current] : current ? [current] : []
        const updated = (currentArr as TypedFieldValue[]).filter((tv) => tv.id !== fieldValueId)
        fvStore.setValue(storeKey, updated)
      } catch (error) {
        toastError({
          title: 'Remove failed',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [removeValue, storeKey]
  )

  return {
    displayFiles,
    uploadingFiles,
    isUploading,
    canAddMore,
    remainingSlots,
    openNativeFilePicker,
    handleBrowseFilesSelected,
    removeFile,
    browseOpen,
    setBrowseOpen,
  }
}
