// apps/web/src/components/file-upload/stores/slices/orchestration-slice.ts

import type { BatchUploadResult, EntityType } from '@auxx/lib/files/types'
import { getEntityConfig } from '@auxx/lib/files/types'
import type { StateCreator } from 'zustand'
import type { UploadTransport } from '../../transport'
import { httpUploadTransport, isUploadTransportError, resolveServerId } from '../../transport'
import { validateFile } from '../../utils'
import { isFileInFlight } from '../file-status'
import type {
  CreateSessionOptions,
  FileState,
  SessionRun,
  UploaderRun,
  UploaderSettledHandler,
  UploadStore,
} from '../types'

/**
 * A fresh empty batch result. A function, not a shared constant: the value is handed
 * to callers and can be assigned into a session (`uploadResult`), where Immer would
 * freeze it — a shared frozen object would then leak that freeze to every later caller.
 */
const emptyBatchResult = (): BatchUploadResult => ({
  totalFiles: 0,
  successCount: 0,
  failedCount: 0,
  results: [],
  overallProgress: 0,
})

/**
 * Orchestration slice - the system's "brain"
 * Manages complete upload lifecycle, API coordination, and cross-slice communication
 */
export interface OrchestrationSlice {
  // State
  uploading: boolean

  /**
   * The network seam. Defaults to {@link httpUploadTransport}; tests swap in a fake
   * with {@link OrchestrationSlice.setTransport} so the orchestration logic can be
   * exercised without stubbing global `fetch` or matching URL strings.
   *
   * It lives on the store rather than in a module-level `let` so it cannot leak
   * between test files, and it survives `reset()` on purpose — a reset clears the
   * work, not the wiring.
   */
  transport: UploadTransport
  setTransport: (transport: UploadTransport) => void

  // Per-file abort tracking
  inFlight: Record<string, { abort?: () => void }>

  /**
   * One entry per session with an upload run in flight, keyed by session id.
   *
   * This used to be a module-level `Map`, which outlived every `reset()` — so a test
   * that started an upload poisoned the next one, and `cleanupUploader` carried a
   * comment admitting it could not clear the half keyed by session. As store state it
   * is cleared by `reset()`, inspectable from a test, and impossible to leak across
   * store instances.
   */
  sessionRuns: Record<string, SessionRun>

  /**
   * One entry per uploader with a session creation in flight, keyed by uploader id
   * (the session does not exist yet, so it cannot be keyed by session). Replaces the
   * module-level `sessionCreatePromises` and `activeRequests` maps.
   */
  uploaderRuns: Record<string, UploaderRun>

  /**
   * At most one settled handler per uploader id.
   *
   * Replaces the module-level `completionHandlers` map, `processingUploaders` set,
   * `subscriptionActive` flag and 30-minute staleness sweep that
   * `use-field-file-upload.ts` kept because the store had no per-uploader completion
   * callback surviving a React unmount. Delivery is owned by `startUpload`, so there
   * is nothing to sweep: a handler fires when a run settles and at no other time.
   */
  uploaderSettledHandlers: Record<string, UploaderSettledHandler>

  /** Drop an uploader's in-flight session creation and abort its controller. */
  cleanupUploader: (uploaderId: string) => void

  /**
   * Subscribe to this uploader's upload runs settling; returns an unsubscribe.
   *
   * The handler receives the run's own {@link BatchUploadResult} — the files that run
   * processed, including any added while it was in flight — and fires once per run,
   * after the store has been updated and after `startUpload`'s promise has its value.
   * A run that settles with the uploader still holding no session delivers nothing.
   *
   * At most one handler per uploader id: registering again replaces the previous one,
   * so a consumer with a deterministic uploader id (a record field, an avatar) can
   * re-register on every interaction without stacking duplicate deliveries. The
   * returned unsubscribe only removes the handler while it is still the registered
   * one, so an unmount cannot clobber a newer registration.
   */
  onUploaderSettled: (uploaderId: string, handler: UploaderSettledHandler) => () => void

  // Core Orchestration Actions
  initializeUpload: (options: InitializeUploadOptions) => Promise<string>
  addFilesWithValidation: (
    files: File[],
    uploaderId: string,
    options?: {
      maxFiles?: number
      maxFileSize?: number
      fileExtensions?: string[]
      allowedMimeTypes?: string[]
      sessionId?: string // Optional sessionId to use
    }
  ) => Promise<{
    addedFileIds: string[]
    validationErrors: string[]
    /**
     * Names of files silently deduped because a byte-identical upload is already
     * in flight in this session. Not validation failures — nothing is wrong, the
     * work is simply already happening — but callers need to tell "nothing added
     * because nothing was needed" apart from "nothing added because everything
     * was rejected" before treating an empty `addedFileIds` as an error.
     */
    skippedDuplicates: string[]
  }>
  /**
   * Upload the pending files of one session. `sessionId` defaults to
   * {@link SessionSlice.activeSessionId} for the callers that have only ever had one
   * session; dispatch never mutates it. Concurrent calls for the same session join the
   * run already in flight instead of uploading its files twice.
   */
  startUpload: (sessionId?: string) => Promise<BatchUploadResult>
  /** @deprecated Alias for `startUpload(sessionId)`; kept for callers outside this module. */
  startUploadForSession: (sessionId: string) => Promise<BatchUploadResult>
  /** Cancel one session's upload. Defaults to the active session. */
  cancelUpload: (sessionId?: string) => void

  // Session creation with concurrency guard
  createSessionWithGuard: (uploaderId: string, options: CreateSessionOptions) => Promise<string>

  // Internal Coordination
  validateAndAddFiles: (
    files: File[],
    sessionId?: string
  ) => Promise<{ validFiles: File[]; errors: string[] }>
  calculateOverallProgress: (sessionId: string) => number
  associateFilesWithSession: (fileIds: string[], sessionId: string) => void

  // NEW: Presigned upload methods
  setInFlight: (fileId: string, abort?: () => void) => void
  clearInFlight: (fileId: string) => void

  // Utility Methods
  retrySession: (sessionId: string) => Promise<void>
}

export interface InitializeUploadOptions {
  entityType: EntityType
  entityId?: string
  files?: File[]
  metadata?: Record<string, any>
  autoStart?: boolean
}

export const createEnhancedOrchestrationSlice: StateCreator<
  UploadStore,
  [['zustand/immer', never], ['zustand/devtools', never]],
  [],
  OrchestrationSlice
> = (set, get) => ({
  // State
  uploading: false,
  inFlight: {} as Record<string, { abort?: () => void }>,
  sessionRuns: {} as Record<string, SessionRun>,
  uploaderRuns: {} as Record<string, UploaderRun>,
  uploaderSettledHandlers: {} as Record<string, UploaderSettledHandler>,
  transport: httpUploadTransport,

  setTransport: (transport: UploadTransport) => {
    set((state) => {
      state.transport = transport
    })
  },

  cleanupUploader: (uploaderId: string) => {
    get().uploaderRuns[uploaderId]?.abortController.abort()
    set((state) => {
      delete state.uploaderRuns[uploaderId]
    })
  },

  onUploaderSettled: (uploaderId: string, handler: UploaderSettledHandler) => {
    set((state) => {
      // A function is not draftable, so Immer stores it as-is and never freezes it.
      state.uploaderSettledHandlers[uploaderId] = handler
    })
    return () => {
      if (get().uploaderSettledHandlers[uploaderId] !== handler) return
      set((state) => {
        delete state.uploaderSettledHandlers[uploaderId]
      })
    }
  },

  /**
   * Session creation with concurrency guard
   */
  createSessionWithGuard: async (
    uploaderId: string,
    options: CreateSessionOptions
  ): Promise<string> => {
    const state = get()

    // Check if session creation is already in progress for this uploader
    const existingPromise = state.uploaderRuns[uploaderId]?.createPromise
    if (existingPromise) {
      return existingPromise
    }

    // Check if session already exists for this uploader
    const existingSessionId = state.uploaderSessions?.[uploaderId]
    if (existingSessionId && state.sessions[existingSessionId]) {
      return existingSessionId
    }

    // Create abort controller for this operation
    const abortController = new AbortController()

    // Create new session with guard
    const createPromise = (async () => {
      try {
        const sessionId = await get().createSession({
          ...options,
          // Pass abort signal if needed in future
        })

        // Check if aborted
        if (abortController.signal.aborted) {
          throw new Error('Session creation cancelled')
        }

        // Atomic update: Map uploaderId to sessionId and move pending files
        set((state) => {
          const pendingIds = state.pendingFileIds?.[uploaderId] || []
          const existingSession = state.sessions[sessionId] || {
            id: sessionId,
            fileIds: [],
            entityType: options.entityType,
            entityId: options.entityId,
            uploading: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'created' as const,
            overallProgress: 0,
            metadata: {},
          }

          // Initialize uploaderSessions if it doesn't exist
          if (!state.uploaderSessions) {
            state.uploaderSessions = {}
          }

          // Map uploader to session
          state.uploaderSessions[uploaderId] = sessionId

          // Associate pending files with session (with proper defaults)
          state.sessions[sessionId] = {
            ...existingSession,
            fileIds: [...existingSession.fileIds, ...pendingIds],
          }

          // Initialize pendingFileIds if it doesn't exist
          if (!state.pendingFileIds) {
            state.pendingFileIds = {}
          }

          // Clear pending IDs for this uploader (use empty array, not undefined)
          state.pendingFileIds[uploaderId] = []
        })

        return sessionId
      } catch (error) {
        // Clean up on failure - properly delete keys
        set((state) => {
          if (state.uploaderSessions) {
            delete state.uploaderSessions[uploaderId]
          }
        })
        throw error
      } finally {
        // Always clear the promise and controller
        set((state) => {
          delete state.uploaderRuns[uploaderId]
        })
      }
    })()

    // Register the guard. Safe in this order: the IIFE above suspends on its first
    // `await` before reaching the `finally` that clears the entry, and this `set` runs
    // in the same synchronous turn.
    set((state) => {
      state.uploaderRuns[uploaderId] = { createPromise, abortController }
    })

    return createPromise
  },

  /**
   * Initializes a complete upload session with files
   * This is the primary entry point for starting an upload workflow
   */
  initializeUpload: async (options: InitializeUploadOptions) => {
    const { entityType, entityId, files = [], metadata = {}, autoStart = false } = options

    try {
      // Create session
      const sessionId = await get().createSession({ entityType, entityId, metadata })

      // Add files to local state if provided
      if (files.length > 0) {
        await get().addFilesWithValidation(files, sessionId)
      }

      // Auto-start upload if requested
      if (autoStart) {
        // Don't await to avoid blocking return
        get()
          .startUpload()
          .catch((error) => {
            get().addError({
              message: error instanceof Error ? error.message : 'Auto-start failed',
              sessionId,
              recoverable: true,
            })
          })
      }

      return sessionId
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize upload'
      get().addError({ message: errorMessage, code: 'INITIALIZATION_FAILED', recoverable: true })
      throw error
    }
  },

  /**
   * Enhanced file addition with validation and error handling
   * Now uses uploaderId for proper scoping
   */
  addFilesWithValidation: async (
    files: File[],
    uploaderId: string,
    options?: {
      maxFiles?: number
      maxFileSize?: number
      fileExtensions?: string[]
      allowedMimeTypes?: string[]
      sessionId?: string // Optional sessionId to use
    }
  ) => {
    const state = get()
    const errors: string[] = []
    const validFileIds: string[] = []
    const skippedDuplicates: string[] = []

    // Get existing pending files for this uploader
    const existingPendingIds = state.pendingFileIds?.[uploaderId] || []
    const existingCount = existingPendingIds.length

    // Use provided sessionId or check if session exists for this uploader
    const sessionId = options?.sessionId || state.uploaderSessions?.[uploaderId]

    // Only files still in flight consume a slot. A session is reused for the whole
    // life of its uploader and nothing ever empties `fileIds`, so counting every
    // entry charged each completed upload against `maxFiles` forever: a single-file
    // field (`maxFiles: 1`) accepted exactly one pick per page load and rejected
    // every later one with "Maximum 1 files allowed". Completed files have already
    // been absorbed into the caller's own value list — which is what the caller
    // derives `maxFiles` from — so counting them here double-charges the same file.
    // Failed and cancelled files occupy nothing.
    const sessionFileCount = sessionId
      ? (state.sessions[sessionId]?.fileIds ?? []).filter((id) => {
          const f = state.files[id]
          return f !== undefined && isFileInFlight(f.status)
        }).length
      : 0

    const totalExisting = existingCount + sessionFileCount

    // Helper function to normalize extensions
    const normalizeExtensions = (extensions?: string[]): string[] => {
      if (!extensions || extensions.length === 0) return []

      return extensions.map((ext) => {
        // Ensure extension starts with dot
        const normalized = ext.startsWith('.') ? ext : `.${ext}`
        return normalized.toLowerCase()
      })
    }

    // Validate each file
    for (const file of files) {
      // Size validation
      if (options?.maxFileSize && file.size > options.maxFileSize) {
        errors.push(`${file.name}: exceeds max size of ${options.maxFileSize} bytes`)
        continue
      }

      // Extension validation (normalized)
      if (options?.fileExtensions && options.fileExtensions.length > 0) {
        const normalizedExtensions = normalizeExtensions(options.fileExtensions)
        const fileExt =
          file.name.lastIndexOf('.') > -1 ? `.${file.name.split('.').pop()?.toLowerCase()}` : ''

        if (!fileExt || !normalizedExtensions.includes(fileExt)) {
          errors.push(
            `${file.name}: invalid file type (allowed: ${normalizedExtensions.join(', ')})`
          )
          continue
        }
      }

      // MIME type validation
      if (options?.allowedMimeTypes && options.allowedMimeTypes.length > 0) {
        if (!options.allowedMimeTypes.includes(file.type)) {
          errors.push(`${file.name}: invalid MIME type ${file.type}`)
          continue
        }
      }

      // Max files validation (check against total)
      if (options?.maxFiles && totalExisting + validFileIds.length >= options.maxFiles) {
        errors.push(`Maximum ${options.maxFiles} files allowed`)
        break
      }

      // Create file state
      const fileId = get().addFiles([file], sessionId)[0]
      if (fileId) {
        validFileIds.push(fileId)
      } else {
        // `addFiles` adds nothing only for its in-session duplicate dedupe (see
        // file-slice) — the identical file is already uploading here. Report it
        // separately from validation errors so callers don't turn a healthy
        // in-flight upload into an "Upload failed" toast.
        skippedDuplicates.push(file.name)
      }
    }

    // Add valid file IDs to pending or session
    if (validFileIds.length > 0) {
      if (sessionId) {
        // Files already added to session by addFiles
      } else {
        // Add to pending
        set((state) => {
          if (!state.pendingFileIds) {
            state.pendingFileIds = {}
          }
          state.pendingFileIds[uploaderId] = [
            ...(state.pendingFileIds[uploaderId] || []),
            ...validFileIds,
          ]
        })
      }
    }

    // Trigger onChange callback if session exists
    if (sessionId) {
      const session = state.sessions[sessionId]
      if (session?.callbacks?.onChange && validFileIds.length > 0) {
        const fileStates = validFileIds.map((id) => state.files[id]).filter((f) => f !== undefined)
        try {
          session.callbacks.onChange(fileStates)
        } catch (error) {
          console.error('Error in onChange callback:', error)
        }
      }
    }

    return { addedFileIds: validFileIds, validationErrors: errors, skippedDuplicates }
  },

  /**
   * Validates files and filters out invalid ones
   */
  validateAndAddFiles: async (files: File[], sessionId?: string) => {
    const targetSessionId = sessionId || get().activeSessionId
    const session = targetSessionId ? get().sessions[targetSessionId] : null

    if (!session) {
      throw new Error('No session available for validation')
    }

    // Use session's validation config, not global
    const { maxFiles, maxFileSize, fileExtensions, allowedMimeTypes } =
      session.validationConfig || {}

    // Get entity-specific validation from entity config
    const entityConfig = getEntityConfig(session.entityType)
    const entityValidation = entityConfig.validation

    const validFiles: File[] = []
    const errors: string[] = []

    // Check total file count limit from session config
    if (maxFiles) {
      const currentFileCount = session.fileIds.length
      const remainingSlots = maxFiles - currentFileCount

      if (remainingSlots <= 0) {
        errors.push(`Maximum ${maxFiles} files already reached`)
        return { validFiles: [], errors }
      }

      if (files.length > remainingSlots) {
        errors.push(`Can only add ${remainingSlots} more files (max: ${maxFiles})`)
        files = files.slice(0, remainingSlots)
      }
    }

    // Check if multiple files allowed
    const allowMultiple = session.behaviorConfig?.allowMultiple ?? true
    if (!allowMultiple && files.length > 1) {
      files = files.slice(0, 1)
      errors.push('Only one file allowed at a time')
    }

    // Validate each file
    for (const file of files) {
      let isValid = true

      // Session-specific size validation
      if (maxFileSize && file.size > maxFileSize) {
        errors.push(
          `${file.name}: Size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum ${(maxFileSize / 1024 / 1024).toFixed(2)}MB`
        )
        isValid = false
      }

      // Session-specific extension validation
      if (fileExtensions?.length) {
        const ext = file.name.split('.').pop()?.toLowerCase()
        const hasValidExt = fileExtensions.some(
          (allowed) => allowed.toLowerCase().replace('.', '') === ext
        )
        if (!hasValidExt) {
          errors.push(
            `${file.name}: Extension .${ext} not allowed. Allowed: ${fileExtensions.join(', ')}`
          )
          isValid = false
        }
      }

      // Session-specific MIME type validation
      if (allowedMimeTypes?.length) {
        const isAllowed = allowedMimeTypes.some((pattern) => {
          if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2)
            return file.type.startsWith(prefix)
          }
          return file.type === pattern
        })
        if (!isAllowed) {
          errors.push(`${file.name}: Type ${file.type} not allowed`)
          isValid = false
        }
      }

      // Entity-specific validation (from entity config)
      if (isValid && entityValidation) {
        try {
          const validation = validateFile(file, entityValidation)
          if (!validation.valid) {
            errors.push(validation.error || `${file.name}: Invalid for ${session.entityType}`)
            isValid = false
          }
        } catch (error) {
          errors.push(
            `Validation failed for ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
          isValid = false
        }
      }

      if (isValid) {
        validFiles.push(file)
      }
    }

    return { validFiles, errors }
  },

  /**
   * Calculates overall progress for a session
   */
  calculateOverallProgress: (sessionId: string) => {
    const session = get().sessions[sessionId]
    if (!session || session.fileIds.length === 0) return 0

    const files = session.fileIds.map((id) => get().files[id]).filter((f) => f !== undefined)
    if (files.length === 0) return 0

    return Math.round(files.reduce((sum, file) => sum + (file.progress ?? 0), 0) / files.length)
  },

  /**
   * Presigned upload flow - uploads files directly to storage
   * Uses per-file presigned sessions and direct storage uploads
   */
  startUpload: async (sessionId?: string): Promise<BatchUploadResult> => {
    const { activeSessionId, sessions, addError, config } = get()
    const maxConcurrency = Math.max(1, config?.maxConcurrentUploads ?? 3)

    // Dispatch is by argument. `activeSessionId` is only a default for the callers that
    // have one session, and is never reassigned to route an upload — two uploaders in
    // one tab used to fight over it, and whichever finished last restored a stale value.
    const targetSessionId = sessionId ?? activeSessionId
    const session = targetSessionId ? sessions[targetSessionId] : undefined

    if (!targetSessionId || !session) {
      // No fallback to global config - require explicit session creation
      addError({
        message:
          'Cannot start upload: No active session. The upload session should be created automatically when files are added. Please try adding files again.',
        code: 'NO_ACTIVE_SESSION',
        recoverable: true,
        details: {
          activeSessionId,
          requestedSessionId: sessionId,
          hint: 'This usually happens when session creation failed. Check console for errors.',
        },
      })
      console.error(
        'startUpload called without a session. Sessions must be created explicitly via createSession().'
      )
      return emptyBatchResult()
    }

    // One run per session: a second start joins the run already in flight rather than
    // uploading the same files twice. The joined run drains in waves, so files added
    // before it finishes are carried by it — the one remaining window is an add that
    // lands after the run's last wave came up empty but before the `finally` below
    // clears the record, which needs another `startUpload` to pick it up.
    const running = get().sessionRuns[targetSessionId]?.promise
    if (running) return running

    const run = async (): Promise<BatchUploadResult> => {
      /**
       * Every file id this run has claimed, claimed exactly once. A file that failed
       * in an earlier wave still reads as `failed` — which is precisely what the
       * pending filter admits — so without this the run would re-upload it forever.
       */
      const claimed = new Set<string>()
      /** Claim order across every wave: this run's own file list. */
      const processed: string[] = []
      const successes: string[] = []
      const failures: Array<{ id: string; error: string }> = []

      /**
       * Whatever is pending in the session right now and not yet claimed.
       *
       * Read fresh from the store on every wave, never from the snapshot taken on
       * entry. Files added WHILE a run is in flight used to be stranded: the join
       * guard hands a second `startUpload` the first run's promise, and that run's
       * file list had already been fixed, so nobody ever uploaded them. Draining in
       * waves is what makes joining a run mean joining a run that carries your files.
       */
      const nextWave = (): FileState[] => {
        const current = get().sessions[targetSessionId]
        if (!current) return []
        return current.fileIds
          .map((id) => get().files[id])
          .filter(
            (f): f is FileState =>
              f !== undefined &&
              !claimed.has(f.id) &&
              (f.status === 'pending' || f.status === 'failed')
          )
      }

      let wave = nextWave()

      if (wave.length === 0) {
        addError({ message: 'No files to upload', code: 'NO_FILES', recoverable: true })
        return emptyBatchResult()
      }

      // The pool's cursor stays a closure local: it is reset per wave, and there is at
      // most one run per session, so two sessions cannot interleave through it.
      let fileIndex = 0

      const processNextFile = async (): Promise<void> => {
        while (true) {
          const file = wave[fileIndex++]
          if (!file?.file) return

          const mimeType = file.mimeType || file.file?.type || 'application/octet-stream'

          try {
            // 1. Create presigned session (per file)
            const presignedConfig = await get().transport.createSession({
              fileName: file.name,
              mimeType,
              expectedSize: file.size ?? 0,
              provider: 'S3',
              entityType: session.entityType,
              entityId: session.entityId,
              // Forward client session metadata to server
              metadata: session.metadata || {},
            })

            // Store the server-side session ID. This is an UPLOAD SESSION nanoid, not a
            // server record id — `serverIdKind` says so, so a consumer that needs a real
            // `MediaAsset` id can tell it apart (see §11.3).
            set((state) => {
              const fs = state.files[file.id]
              if (fs) {
                fs.serverFileId = presignedConfig.sessionId
                fs.metadata = { ...fs.metadata, serverIdKind: 'session' }
              }
            })

            // 2. Upload file directly to storage
            get().updateFileStatus(file.id, 'uploading')

            // Mark first stage as active when upload starts
            get().updateFileProgress(file.id, {
              stages: file.stages?.map((s, idx) => ({
                ...s,
                status: idx === 0 ? 'active' : 'pending',
              })),
            })

            const { abort, promise } = get().transport.uploadObject({
              file: file.file,
              config: presignedConfig,
              onProgress: (progress) => {
                get().updateFileProgress(file.id, {
                  fileId: file.id,
                  filename: file.name,
                  overallProgress: progress.percentage,
                  uploadProgress: progress.percentage,
                  bytesUploaded: progress.loaded,
                  totalBytes: progress.total,
                  // Don't pass stages: [] to avoid clearing stages
                })
              },
            })

            // Track for cancellation
            get().setInFlight(file.id, abort)

            const uploadResult = await promise
            get().clearInFlight(file.id)
            get().updateFileStatus(file.id, 'processing')

            // Mark first stage as completed and second as active when switching to processing
            get().updateFileProgress(file.id, {
              stages: file.stages?.map((s, idx) => ({
                ...s,
                status: idx === 0 ? 'completed' : idx === 1 ? 'active' : 'pending',
                progress: idx === 0 ? 100 : 0,
              })),
            })

            // 3. Complete the upload
            const completionData = await get().transport.completeSession(
              presignedConfig.sessionId,
              {
                storageKey: presignedConfig.storageKey, // Use storage key from session creation
                size: file.size ?? 0,
                mimeType,
                etag: uploadResult.etag,
                uploadId: uploadResult.uploadId,
                parts: uploadResult.parts,
              }
            )

            // Which kind of server record the completion actually produced — see
            // `transport/server-id.ts` and guide §11.3.
            const { serverId, kind: serverIdKind } = resolveServerId(completionData)

            // Atomic update: set serverFileId, url, and status together
            // This prevents race conditions where onComplete reads state before serverFileId is set
            set((state) => {
              const f = state.files[file.id]
              if (f) {
                // Store the server record id (asset first, file second) as serverFileId
                if (serverId) {
                  f.serverFileId = serverId
                }
                f.metadata = { ...f.metadata, serverIdKind }
                // Store URL for previews
                if (completionData?.url) {
                  f.url = completionData.url
                }
                // Set status to completed
                f.status = 'completed'
                f.progress = 100
                // Update stages
                if (f.stages) {
                  f.stages = f.stages.map((s) => ({ ...s, status: 'completed', progress: 100 }))
                }
              }
            })
            successes.push(file.id)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed'
            // For a transport failure `message` is now the server's own prose — the
            // storage-quota upgrade prompt, the 422 policy reason — instead of the
            // `"Session create failed (403)"` placeholder the inline fetch produced.
            get().addError({
              message,
              code: isUploadTransportError(error) ? error.code : undefined,
              details: isUploadTransportError(error) ? error.details : undefined,
              fileId: file.id,
              sessionId: targetSessionId,
              recoverable: true,
            })
            // `setFileError`, not `updateFileStatus('failed')`: the latter leaves
            // `FileState.error` unset (its own comment says "caller should also set
            // error ... separately" and no caller ever did), so every failed upload
            // reached `BatchUploadResult.results[].error` and `toUploadResult` as
            // `undefined` — a second place the real message died.
            get().setFileError(file.id, message)
            failures.push({ id: file.id, error: message })
            get().clearInFlight(file.id)
          }
        }
      }

      // One concurrent pool per wave. The loop re-reads the session between waves, so
      // a file added mid-run is uploaded by this run rather than waiting for the next
      // `startUpload` that may never come.
      while (wave.length > 0) {
        for (const f of wave) claimed.add(f.id)
        processed.push(...wave.map((f) => f.id))
        fileIndex = 0
        const poolSize = Math.min(maxConcurrency, wave.length)
        await Promise.all(new Array(poolSize).fill(0).map(() => processNextFile()))
        wave = nextWave()
      }

      // Run-scoped, not session-scoped. `totalFiles` used to count every file the
      // session had ever held while `successCount` counted only this run's, so the two
      // halves of one result disagreed for any session that uploads more than once.
      // The result now describes exactly what this run did — which is also what
      // `onUploaderSettled` hands its subscribers.
      const finalFiles = processed.map((id) => get().files[id]).filter((f) => f !== undefined)
      return {
        totalFiles: finalFiles.length,
        successCount: successes.length,
        failedCount: failures.length,
        results: finalFiles.map((f) => ({
          fileId: f.id,
          filename: f.name,
          success: f.status === 'completed',
          error: f.error,
          url: f.url,
          checksum: f.checksum,
        })),
        overallProgress: finalFiles.length
          ? Math.round(
              finalFiles.reduce((sum, f) => sum + (f.progress ?? 0), 0) / finalFiles.length
            )
          : 0,
      }
    }

    // Start the run, then publish it. `run()` cannot reach its own bookkeeping before
    // this `set` — its cleanup lives out here, not inside the promise.
    const promise = run()
    set((state) => {
      state.sessionRuns[targetSessionId] = { promise }
      state.uploading = true
      const target = state.sessions[targetSessionId]
      if (target) {
        target.uploading = true
        target.uploadStartTime = Date.now()
      }
    })

    let result: BatchUploadResult | undefined
    let failure: string | undefined
    try {
      result = await promise
      return result
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Upload failed'
      throw error
    } finally {
      set((state) => {
        delete state.sessionRuns[targetSessionId]
        // The global flag is derived from the runs, not stamped: another session may
        // still be uploading, and clearing it unconditionally stopped its spinner.
        state.uploading = Object.keys(state.sessionRuns).length > 0
        const target = state.sessions[targetSessionId]
        if (target) {
          // Always cleared, including on the "nothing pending" early return, which used
          // to leave the session stuck reading `uploading: true` forever.
          target.uploading = false
          if (result) target.uploadResult = result
          if (failure) target.uploadError = failure
        }
      })

      // Deliver to every uploader currently pointed at this session, after the store
      // is up to date and outside the Immer producer — a handler is free to read fresh
      // state and to write back. Nothing sweeps and nothing polls: a settled handler
      // fires here and nowhere else.
      if (result) {
        const settled = result
        const { uploaderSessions, uploaderSettledHandlers } = get()
        for (const [uploaderId, mappedSessionId] of Object.entries(uploaderSessions ?? {})) {
          if (mappedSessionId !== targetSessionId) continue
          const handler = uploaderSettledHandlers[uploaderId]
          if (!handler) continue
          try {
            handler(settled)
          } catch (error) {
            console.error('[uploadStore] onUploaderSettled handler threw', error)
          }
        }
      }
    }
  },

  /**
   * @deprecated Use `startUpload(sessionId)`.
   *
   * Kept only so callers outside this module keep working. It no longer reassigns
   * `activeSessionId` around the call: the per-session guard, the session bookkeeping
   * and the run record all live in `startUpload` now.
   */
  startUploadForSession: (sessionId: string): Promise<BatchUploadResult> =>
    get().startUpload(sessionId),

  /**
   * Enhanced upload cancellation with per-file abort tracking
   */
  cancelUpload: (sessionId?: string) => {
    const { activeSessionId, sessions, inFlight } = get()
    const targetSessionId = sessionId ?? activeSessionId
    const session = targetSessionId ? sessions[targetSessionId] : undefined

    // Abort only this session's files. Aborting every handle on the page cancelled a
    // second uploader's in-flight files as collateral. With no session at all there is
    // nothing to scope to, so fall back to the old blanket abort.
    const abortIds = session ? session.fileIds : Object.keys(inFlight)
    abortIds.forEach((fileId) => inFlight[fileId]?.abort?.())
    set((state) => {
      abortIds.forEach((fileId) => {
        delete state.inFlight[fileId]
      })
    })

    if (session && targetSessionId) {
      // Cancel all files in session
      session.fileIds.forEach((fileId) => {
        get().cancelFile(fileId)
      })

      // Update session status
      set((state) => {
        const target = state.sessions[targetSessionId]
        if (target) {
          target.status = 'cancelled'
          target.updatedAt = new Date()
        }
      })
    }

    set((state) => {
      // Derived, not stamped: a different session may still have a run in flight.
      state.uploading = Object.keys(state.sessionRuns).length > 0
    })
  },

  /**
   * Retry failed files in a session
   */
  retrySession: async (sessionId: string) => {
    const session = get().sessions[sessionId]
    if (!session) return

    // Reset failed files to pending
    session.fileIds.forEach((fileId) => {
      const file = get().files[fileId]
      if (file && file.status === 'failed') {
        get().retryFile(fileId)
      }
    })

    // Reset session status
    set((state) => {
      const sess = state.sessions[sessionId]
      if (sess) {
        sess.status = 'created'
        sess.updatedAt = new Date()
      }
    })

    // Restart this session's upload. It used to run only when the session happened to
    // be the active one, so retrying any other session reset the statuses and stopped.
    await get().startUpload(sessionId)
  },

  /**
   * Helper methods for per-file abort tracking
   */
  setInFlight: (fileId: string, abort?: () => void) => {
    set((state) => {
      state.inFlight[fileId] = { abort }
    })
  },

  clearInFlight: (fileId: string) => {
    set((state) => {
      delete state.inFlight[fileId]
    })
  },

  /**
   * Associate files with a session after they've been added to store
   * Used for background session creation flow
   */
  associateFilesWithSession: (fileIds: string[], sessionId: string) => {
    set((state) => {
      const session = state.sessions[sessionId]
      if (session) {
        // Add file IDs to session
        session.fileIds.push(...fileIds)
        session.updatedAt = new Date()

        // Update reverse mapping for fast lookups and update file metadata
        fileIds.forEach((fileId) => {
          state.fileIdToSessionId[fileId] = sessionId

          // Update file's parentId and metadata to match session's entityId (target folder)
          const file = state.files[fileId]
          if (file) {
            file.parentId = session.entityId || null
            if (!file.metadata) {
              file.metadata = {}
            }
            file.metadata.targetFolderId = session.entityId || null
          }
        })
      }
    })
  },
})
