// apps/web/src/components/fields/inputs/hooks/use-field-file-upload.ts
'use client'

import type { FileValue } from '@auxx/lib/field-values/client'
import type { BatchUploadResult, FileTypeCategory } from '@auxx/lib/files/client'
import { getMimePatternsForCategories } from '@auxx/lib/files/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import type { JsonFieldValue, TypedFieldValue } from '@auxx/types/field-value'
import { type FileRef, getFileRefDownloadUrl } from '@auxx/types/file-ref'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FileOptions } from '~/components/custom-fields/ui/file-options-editor'
import type { FileState } from '~/components/file-upload/stores'
import { isFileInFlight, useUploadStore } from '~/components/file-upload/stores'
import type { FileItem } from '~/components/files/files-store'
import { convertHeicFiles } from '~/components/files/utils/convert-heic'
import { useFileRefs } from '~/components/resources/hooks/use-file-refs'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { getFileRefStoreState } from '~/components/resources/store/file-ref-store'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { buildCanonicalFieldValueKey } from '~/components/resources/utils/canonicalize-field-ref'
import { api } from '~/trpc/react'
import { vanillaApi } from '~/trpc/vanilla'

// =============================================================================
// COMPLETION CONTEXT
// =============================================================================

/**
 * What a settled upload needs to know to write the field value.
 *
 * Captured when the handler is registered, so it survives the React unmount that
 * closing a popover mid-upload causes. The store now owns the registry and the
 * delivery (`onUploaderSettled`); this used to be a module-level `Map` read by a
 * hand-rolled store subscription with a re-entrancy `Set`, a `subscriptionActive`
 * flag, a 30-minute staleness sweep and a `__fieldNotifiedComplete` one-shot latch
 * on the session — all of it a workaround for the store having no per-uploader
 * completion callback.
 */
interface CompletionContext {
  recordId: string
  fieldRef: string
  storeKey: string
  allowMultiple: boolean
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
  /** `null` is a real stored state (avatar explicitly cleared) — keep it distinct
   *  from `undefined` so a rollback restores exactly what was there. */
  priorAvatarUrl: string | null | undefined
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
): { rollback: () => void; priorAvatarUrl: string | null | undefined } {
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
 *   Backend routes FILE through `setMultiValue`, which reconciles the row
 *   set in a single locked transaction — an unchanged position keeps its
 *   row id, so ids the tile UI holds stay valid across replaces. A reorder
 *   still rewrites payloads across surviving positions.
 * - `allowMultiple: true`  → `fieldValue.add` per file (append semantics).
 *
 * Updates the local `useFieldValueStore` with the resulting TypedFieldValues
 * so UI reflects the change immediately.
 */
interface ApplyContext {
  recordId: string
  fieldRef: string
  storeKey: ReturnType<typeof buildCanonicalFieldValueKey>['key']
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

/**
 * Release every file this uploader's session has finished with.
 *
 * A session lives for the whole life of its uploader and nothing else empties
 * `fileIds`, so leaving settled entries there meant the NEXT pick's completion
 * collected this pick's completed files too — and a single-file field applies
 * `successFiles[0]`, re-saving the OLD ref instead of the newly picked one. Only
 * terminal files are released: a pick still in flight keeps its rows.
 */
function releaseSettledFiles(uploaderId: string, runFileIds: string[]): void {
  const state = useUploadStore.getState()
  const sessionId = state.uploaderSessions?.[uploaderId]
  const session = sessionId ? state.sessions[sessionId] : undefined
  const settled = new Set(runFileIds)
  for (const id of session?.fileIds ?? []) {
    const f = state.files[id]
    if (f && !isFileInFlight(f.status)) settled.add(id)
  }
  if (settled.size > 0) state.removeFiles([...settled])
}

/**
 * Turn one settled upload run into a field value.
 *
 * `result` is the run's own {@link BatchUploadResult} — the files that run uploaded,
 * including any the user added while it was in flight. The `FileState`s are re-read
 * from the store rather than taken from `result.results`, because the field needs
 * `serverFileId` and the batch result does not carry it.
 */
async function handleUploadCompletion(
  uploaderId: string,
  handler: CompletionContext,
  result: BatchUploadResult
) {
  const store = useUploadStore.getState()
  // `UploadResult.fileId` is optional in the shared type; every result the store
  // produces carries one, but narrow rather than assert.
  const runFileIds = result.results
    .map((r) => r.fileId)
    .filter((id): id is string => id !== undefined)
  const files = runFileIds
    .map((id) => store.files[id])
    .filter((f): f is FileState => f !== undefined)
  const successFiles = files.filter((f) => f.status === 'completed' && f.serverFileId)
  const pendingAvatar = pendingAvatarByKey.get(uploaderId)

  if (successFiles.length === 0) {
    // Upload failed (or was cancelled) entirely — rollback any optimistic avatar
    // write and clean up.
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
    releaseSettledFiles(uploaderId, runFileIds)
    return
  }

  try {
    const filesToApply = handler.allowMultiple ? successFiles : [successFiles[0]!]
    const refs = filesToApply.map((f) => `asset:${f.serverFileId!}`)

    // Seed the ref store with what we ALREADY know, before the value write.
    //
    // `resolveFileRefs` would tell us name/mimeType/size — all three of which we
    // have had in hand since the picker closed. Waiting for it opened a window
    // where the ref existed but its detail did not, and every surface handled that
    // window differently: the picker dropped the row, then showed a literal
    // "Unknown file", then the image; the field row rendered skeletons. Seeding
    // closes the window to zero, so a file goes from uploading to fully rendered in
    // one transition, with its actions, and never round-trips for data it owns.
    getFileRefStoreState().completeBatch(
      filesToApply.map((f, i) => ({
        ref: refs[i]!,
        name: f.name,
        mimeType: f.mimeType ?? null,
        size: f.size ?? null,
      })),
      refs
    )

    await applyPendingFileRefs(
      {
        recordId: handler.recordId,
        fieldRef: handler.fieldRef,
        storeKey: handler.storeKey as ReturnType<typeof buildCanonicalFieldValueKey>['key'],
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
    // The field values (and the ref-store details backing the badges) are already
    // written by this point, so nothing still renders from these entries.
    releaseSettledFiles(uploaderId, runFileIds)
    pendingAvatarByKey.delete(uploaderId)
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

/** Patch applied to one photo's envelope by the tile editor. */
export interface PhotoMetaPatch {
  /** `undefined` clears the caption. */
  caption?: string
  internal?: boolean
}

interface UseFieldFileUploadReturn {
  displayFiles: Array<{
    id: string // fieldValueId — for removal
    ref: FileRef
    name: string
    mimeType: string | null
    size: number | null
    /** Caption from the FILE envelope (`{ ref, caption?, internal? }`). */
    caption?: string
    /** When true, the photo is internal-only (stripped from customer-facing payloads). */
    internal?: boolean
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
  /** True when the field is images-only (`allowedFileTypes` is exactly `['image']`) —
   * gates the camera-capture affordance (37b-scouting-quote-photos.md §4/§8). */
  supportsCameraCapture: boolean
  openNativeFilePicker: () => void
  /** Same picker, opened with `capture='environment'` so mobile browsers default to the
   * device camera instead of the file/photo chooser. */
  openCameraCapture: () => void
  handleBrowseFilesSelected: (files: FileItem[]) => Promise<void>
  removeFile: (fieldValueId: string) => Promise<void>
  /**
   * Edit a photo's caption/internal flag. Composes the FULL envelope array from the
   * freshest store state and writes it via `fieldValue.set` (mode 'set') — the only
   * sanctioned edit path (plans/dispatch/37b-scouting-quote-photos.md §2). Never
   * edit via remove+add: `add` dedups on the bare `{ ref }` shape and would duplicate
   * an already-captioned row.
   */
  updatePhotoMeta: (fieldValueId: string, patch: PhotoMetaPatch) => Promise<void>
  browseOpen: boolean
  setBrowseOpen: (open: boolean) => void
}

// Stable empty array references
const EMPTY_UPLOADING: UploadingFile[] = []
const EMPTY_ARRAY: TypedFieldValue[] = []

// Concrete (non-wildcard) accept list for images-only FILE fields — deliberately omits
// `image/heic`/`image/heif`. See `openPicker`'s doc comment in the hook below for why.
const IMAGE_ONLY_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp'

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

  // Pre-compute the store key — through the CANONICAL builder, the same one
  // `useFieldValue` subscribes with.
  //
  // `buildFieldValueKey` normalizes the field ref but nothing else. It leaves an
  // alias definition prefix (`parts:…` rather than the def CUID) and a static-key
  // or systemAttribute field half exactly as given, so an upload writing through
  // it landed on a slot no subscriber reads: the drawer header updated (it reads
  // `avatarUrl` from the record store) while the FILE field row below kept showing
  // the previous photo until a reload. `buildCanonicalFieldValueKey` rewrites both
  // halves — that is precisely the disagreement it exists to prevent.
  const { key: storeKey } = useMemo(
    () => buildCanonicalFieldValueKey(recordId as RecordId, fieldRef as FieldReference),
    [recordId, fieldRef]
  )

  // The settled context this uploader writes with. Held in a ref so the handler
  // registered below always reads the CURRENT record/field/multiplicity without
  // having to re-subscribe on every render.
  const completionContext = useRef<CompletionContext>({
    recordId,
    fieldRef,
    storeKey,
    allowMultiple: fileOptions.allowMultiple,
  })
  useEffect(() => {
    completionContext.current = {
      recordId,
      fieldRef,
      storeKey,
      allowMultiple: fileOptions.allowMultiple,
    }
  }, [recordId, fieldRef, storeKey, fileOptions.allowMultiple])

  /** Unsubscribe for whichever registration is currently ours. */
  const unsubscribeSettled = useRef<(() => void) | null>(null)

  /**
   * Register this uploader's settled handler with the store.
   *
   * The store keeps at most one per uploader id and replaces on re-registration, so
   * calling this from both mount and picker-open is idempotent. Picker-open matters
   * because the same field can be mounted twice (a row and a popover) under the same
   * deterministic uploader id, and the first of the two to unmount would otherwise
   * take the shared registration with it.
   */
  const subscribeSettled = useCallback(() => {
    unsubscribeSettled.current = useUploadStore
      .getState()
      .onUploaderSettled(uploaderId, (result) =>
        handleUploadCompletion(uploaderId, completionContext.current, result).catch(console.error)
      )
  }, [uploaderId])

  // Unsubscribe on unmount — but NEVER while work is outstanding. Closing the popover
  // mid-upload must leave the handler registered so the field value still lands, and
  // so reopening reattaches to the same session and shows the progress already in
  // flight. `session.uploading` alone is too narrow a test: it only flips inside
  // `startUpload`, so a pick that has been added but not yet started reads as idle,
  // and unmounting in that window dropped the handler and silently lost the upload.
  // Ask the files instead of the flag.
  useEffect(() => {
    subscribeSettled()
    return () => {
      const state = useUploadStore.getState()
      const sessionId = state.uploaderSessions?.[uploaderId]
      const session = sessionId ? state.sessions[sessionId] : null
      const hasOutstandingWork =
        session?.uploading ||
        (session?.fileIds ?? []).some((id) => {
          const f = state.files[id]
          return f !== undefined && isFileInFlight(f.status)
        })
      if (!hasOutstandingWork) {
        // The store's unsubscribe is identity-checked, so this is a no-op if a
        // second mount of the same field has registered since.
        unsubscribeSettled.current?.()
      }
    }
  }, [uploaderId, subscribeSettled])

  // Subscribe to field value store for TypedFieldValue[] (with IDs)
  const typedValues = useFieldValueStore(
    useShallow((state) => {
      const val = state.values[storeKey]
      if (!val) return EMPTY_ARRAY
      return Array.isArray(val) ? (val as TypedFieldValue[]) : [val as TypedFieldValue]
    })
  )

  // Extract file refs from typed values — carries caption/internal through from the
  // envelope (`{ ref, caption?, internal? }`), additive on top of the original `{ ref }`
  // shape (plans/dispatch/37b-scouting-quote-photos.md §2).
  const fileRefs = useMemo(
    () =>
      typedValues
        .filter((tv) => tv.type === 'json' && (tv as JsonFieldValue).value?.ref)
        .map((tv) => {
          const value = (tv as JsonFieldValue).value as unknown as FileValue
          const { sourceType, id } = parseFileRef(value.ref)
          return {
            fieldValueId: tv.id,
            ref: value.ref,
            sourceType,
            id,
            caption: value.caption,
            internal: value.internal,
          }
        }),
    [typedValues]
  )

  // Resolve display details through the shared hydration store — one batched
  // request per viewport instead of a query per hook instance (LinePhotoPopover
  // mounts this for every line row).
  const refs = useMemo(() => fileRefs.map((fr) => fr.ref), [fileRefs])
  const { details: fileDetails, isLoading: isResolvingRefs } = useFileRefs(refs)

  // Build display files by joining fileRefs with details
  const displayFiles = useMemo(() => {
    if (fileRefs.length === 0) return []

    // NOTE: no early return while resolving. Bailing out here blanked the list for
    // the whole `resolveFileRefs` round-trip, so a file that had just finished
    // uploading vanished and then reappeared — the "takes time to show the badge"
    // gap. A ref we hold is a file that exists; render its row immediately and let
    // the name fill in. The `isResolvingRefs` arm of the filter below already keeps
    // unresolved rows alive, which is exactly this case.
    const detailMap = new Map(fileDetails.map((d) => [d.ref, d]))
    return (
      fileRefs
        // Drop refs that resolved to nothing (deleted file, another org), but keep
        // ones still resolving so a freshly uploaded file doesn't blink out.
        .filter((fr) => detailMap.has(fr.ref) || isResolvingRefs)
        .map((fr) => {
          const detail = detailMap.get(fr.ref)
          return {
            id: fr.fieldValueId,
            ref: fr.ref as FileRef,
            // Empty, NOT 'Unknown file'. That sentinel doubled as the drop test
            // above, so it had to be a real string — and every renderer happily
            // printed it at the user during the resolve window. The filter is now
            // an explicit map lookup, freeing the name to say "not known yet" and
            // letting renderers show a skeleton instead of a scary label.
            name: detail?.name ?? '',
            mimeType: detail?.mimeType ?? null,
            size: detail?.size ?? null,
            caption: fr.caption,
            internal: fr.internal,
          }
        })
    )
  }, [fileRefs, fileDetails, isResolvingRefs])

  // Set of asset IDs fully absorbed into displayFiles (store entry + resolved details).
  // Only mark as absorbed once the ref has resolved — prevents the upload entry
  // from disappearing before displayFiles can render it.
  const absorbedAssetIds = useMemo(() => {
    const ids = new Set<string>()
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
      if (!f) continue
      // Keep completed files in fingerprint until absorbed
      if (f.status === 'completed') {
        if (f.serverFileId && !absorbedAssetIds.has(f.serverFileId)) {
          parts.push(`${f.id}:settling`)
        }
        continue
      }
      // failed, cancelled and deleting files own no row
      if (!isFileInFlight(f.status)) continue
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
      .filter((f): f is FileState => f !== undefined)
      .filter((f) => {
        // Keep completed files visible until displayFiles absorbs them
        if (f.status === 'completed') {
          return f.serverFileId ? !absorbedAssetIds.has(f.serverFileId) : false
        }
        return isFileInFlight(f.status)
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
  //   replaces the existing value (atomic in-place reconcile via fieldValue.set).
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

  // Images-only field (37b-scouting-quote-photos.md §1/§4/§8: `quote_photos` /
  // `line_item_photos` / `invoice_photos` are `allowedFileTypes: ['image']`) — gates the
  // camera-capture affordance.
  const isImagesOnly =
    fileOptions.allowedFileTypes?.length === 1 && fileOptions.allowedFileTypes[0] === 'image'

  /**
   * Open the native file picker, optionally requesting camera capture.
   *
   * `capture` is deliberately combined with a concrete (non-wildcard) image MIME list
   * rather than `getMimePatternsForCategories`'s `'image/*'` — that constraint is what
   * makes iOS Safari transcode a HEIC capture/pick to JPEG itself before handing the
   * file back (the 'image' category excludes `.heic`, `file-type-constants.ts:9-18`).
   * `convertHeicFiles` below is the client-side backstop for whatever slips through.
   * Registers the completion handler BEFORE opening the dialog. For single-file fields,
   * always opens — upload replaces any existing value.
   */
  const openPicker = useCallback(
    async (capture?: 'environment') => {
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

        // Re-register the settled handler. Idempotent — the store keeps one per
        // uploader id — and it re-arms the registration if a second mount of the same
        // field unsubscribed on its way out.
        subscribeSettled()

        // Build accept string for file input. Images-only fields use a concrete list
        // (no `image/heic`) instead of the `'image/*'` wildcard — see doc comment above.
        const acceptTypes = isImagesOnly
          ? IMAGE_ONLY_ACCEPT
          : fileOptions.allowedFileTypes
            ? getMimePatternsForCategories(fileOptions.allowedFileTypes as FileTypeCategory[]).join(
                ','
              )
            : undefined

        // Create detached native file input (survives React unmount)
        const input = document.createElement('input')
        input.type = 'file'
        if (acceptTypes) input.accept = acceptTypes
        if (capture) input.capture = capture
        input.multiple = fileOptions.allowMultiple && effectiveSlots > 1
        input.style.display = 'none'
        document.body.appendChild(input)

        input.onchange = async () => {
          const rawFiles = Array.from(input.files ?? [])
          document.body.removeChild(input)

          if (rawFiles.length === 0) return

          // Backstop transcode for any HEIC/HEIF that slipped past the accept-list
          // constraint above (see `convert-heic.ts`).
          const files = isImagesOnly ? await convertHeicFiles(rawFiles) : rawFiles

          try {
            const storeNow = useUploadStore.getState()
            const addResult = await storeNow.addFilesWithValidation(files, uploaderId, {
              maxFiles: effectiveSlots,
            })

            // A pick that only re-selected files already uploading in this session
            // is a no-op, not a failure — the in-flight upload's own completion
            // lands the value. Erroring here rolled back the optimistic avatar and
            // toasted "Upload failed" over a perfectly healthy upload.
            if (addResult.addedFileIds.length === 0 && addResult.validationErrors.length === 0) {
              return
            }

            // A rejected pick adds nothing, so `startUpload` would be a silent
            // no-op: nothing throws and no run ever settles.
            // Fail the pick here instead — same shape as the `catch` below, and the
            // same contract `useFileUpload` already honours.
            if (addResult.addedFileIds.length === 0) {
              throw new Error(
                addResult.validationErrors[0] ?? 'The selected file could not be added.'
              )
            }

            // Some added, some rejected — the upload proceeds, but say what was dropped.
            if (addResult.validationErrors.length > 0) {
              toastError({
                title: 'Some files were skipped',
                description: addResult.validationErrors.join('; '),
              })
            }

            // Optimistic avatar preview: show the locally-selected image instantly
            // via a blob URL. `handleUploadCompletion` swaps to a stable download
            // URL on server success, or rolls back on failure. Deliberately AFTER
            // the add — a pick that adds nothing (all duplicates, all rejected)
            // must not overwrite the pending-avatar state a still-uploading pick
            // registered under this uploaderId.
            if (isAvatarField(recordId, fieldRef) && files[0]) {
              const blobUrl = URL.createObjectURL(files[0])
              const { priorAvatarUrl } = optimisticallyWriteAvatar(recordId, blobUrl)
              pendingAvatarByKey.set(uploaderId, {
                recordId,
                priorAvatarUrl,
                blobUrl,
              })
            }

            await storeNow.startUpload(sessionId)
          } catch (err) {
            console.error('[useFieldFileUpload] upload error:', err)
            toastError({
              title: 'Upload failed',
              description: err instanceof Error ? err.message : 'Unknown error',
            })
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
    },
    [
      canOpenPicker,
      uploaderId,
      fieldRef,
      recordId,
      effectiveSlots,
      fileOptions,
      isImagesOnly,
      subscribeSettled,
    ]
  )

  const openNativeFilePicker = useCallback(() => {
    void openPicker()
  }, [openPicker])

  const openCameraCapture = useCallback(() => {
    void openPicker('environment')
  }, [openPicker])

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

  /**
   * Edit one photo's caption/internal flag (tile editor save). Builds the full envelope
   * array from the freshest store state at call time — not from the `typedValues`
   * closure — to minimize clobbering a concurrent upload's `add`
   * (plans/dispatch/37b-scouting-quote-photos.md §2 concurrency caveat, accepted for v1).
   */
  const updatePhotoMeta = useCallback(
    async (fieldValueId: string, patch: PhotoMetaPatch) => {
      const fvStore = useFieldValueStore.getState()
      const current = fvStore.values[storeKey]
      const currentArr = (
        Array.isArray(current) ? current : current ? [current] : []
      ) as TypedFieldValue[]

      const envelopes: FileValue[] = currentArr
        .filter(
          (tv): tv is JsonFieldValue =>
            tv.type === 'json' && !!(tv.value as unknown as FileValue)?.ref
        )
        .map((tv) => {
          const value = tv.value as unknown as FileValue
          if (tv.id !== fieldValueId) {
            return { ref: value.ref, caption: value.caption, internal: value.internal }
          }
          return {
            ref: value.ref,
            caption: patch.caption,
            internal: patch.internal,
          }
        })

      try {
        const result = await vanillaApi.fieldValue.set.mutate({
          recordId,
          fieldId: fieldRef,
          value: envelopes,
        })
        fvStore.setValue(storeKey, (result?.values ?? []) as TypedFieldValue[])
      } catch (error) {
        toastError({
          title: 'Failed to save photo details',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      }
    },
    [recordId, fieldRef, storeKey]
  )

  return {
    displayFiles,
    uploadingFiles,
    isUploading,
    canAddMore,
    canAppend,
    remainingSlots: effectiveSlots,
    supportsCameraCapture: isImagesOnly,
    openNativeFilePicker,
    openCameraCapture,
    handleBrowseFilesSelected,
    removeFile,
    updatePhotoMeta,
    browseOpen,
    setBrowseOpen,
  }
}
