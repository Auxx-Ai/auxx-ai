// apps/web/src/components/file-upload/stores/slices/orchestration-slice.ts

import type { BatchUploadResult, EntityType } from '@auxx/lib/files/types'
import { getEntityConfig } from '@auxx/lib/files/types'
import type { StateCreator } from 'zustand'
import { validateFile } from '../../utils'
import { directUpload } from '../../utils/direct-upload'
import type { CreateSessionOptions, UploadStore } from '../types'

/**
 * Module-level promise maps for concurrency control (outside component lifecycle)
 */
const sessionCreatePromises = new Map<string, Promise<string>>()
const uploadPromises = new Map<string, Promise<BatchUploadResult>>()
const activeRequests = new Map<string, AbortController>()

/**
 * Clean up helper for uploader-specific resources
 */
export const cleanupUploader = (uploaderId: string) => {
  // Cancel any in-flight requests
  const controller = activeRequests.get(uploaderId)
  if (controller) {
    controller.abort()
    activeRequests.delete(uploaderId)
  }

  // Clear promises
  sessionCreatePromises.delete(uploaderId)

  // Note: uploadPromises are keyed by sessionId, need different cleanup
}

/**
 * Orchestration slice - the system's "brain"
 * Manages complete upload lifecycle, API coordination, and cross-slice communication
 */
export interface OrchestrationSlice {
  // State
  uploading: boolean

  // Per-file abort tracking
  inFlight: Record<string, { abort?: () => void }>

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
  ) => Promise<{ addedFileIds: string[]; validationErrors: string[] }>
  startUpload: () => Promise<BatchUploadResult>
  startUploadForSession: (sessionId: string) => Promise<BatchUploadResult>
  cancelUpload: () => void

  // Session creation with concurrency guard
  createSessionWithGuard: (uploaderId: string, options: CreateSessionOptions) => Promise<string>

  // Internal Coordination
  validateAndAddFiles: (
    files: File[],
    sessionId?: string
  ) => Promise<{ validFiles: File[]; errors: string[] }>
  handleAPIResponse: (response: any, sessionId: string) => void
  coordinateSSEEvents: (sessionId: string) => void
  calculateOverallProgress: (sessionId: string) => number
  associateFilesWithSession: (fileIds: string[], sessionId: string) => void

  // NEW: Presigned upload methods
  setInFlight: (fileId: string, abort?: () => void) => void
  clearInFlight: (fileId: string) => void

  // Utility Methods
  retrySession: (sessionId: string) => Promise<void>
  cleanupSession: (sessionId: string) => void
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

  /**
   * Session creation with concurrency guard
   */
  createSessionWithGuard: async (
    uploaderId: string,
    options: CreateSessionOptions
  ): Promise<string> => {
    const state = get()

    // Check if session creation is already in progress for this uploader
    const existingPromise = sessionCreatePromises.get(uploaderId)
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
    activeRequests.set(uploaderId, abortController)

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
        sessionCreatePromises.delete(uploaderId)
        activeRequests.delete(uploaderId)
      }
    })()

    // Store the promise
    sessionCreatePromises.set(uploaderId, createPromise)

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

    // Get existing pending files for this uploader
    const existingPendingIds = state.pendingFileIds?.[uploaderId] || []
    const existingCount = existingPendingIds.length

    // Use provided sessionId or check if session exists for this uploader
    const sessionId = options?.sessionId || state.uploaderSessions?.[uploaderId]
    const sessionFileCount = sessionId ? state.sessions[sessionId]?.fileIds.length || 0 : 0

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
        const fileStates = validFileIds.map((id) => state.files[id]).filter(Boolean)
        try {
          session.callbacks.onChange(fileStates)
        } catch (error) {
          console.error('Error in onChange callback:', error)
        }
      }
    }

    return { addedFileIds: validFileIds, validationErrors: errors }
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

    const files = session.fileIds.map((id) => get().files[id]).filter(Boolean)
    if (files.length === 0) return 0

    return Math.round(files.reduce((sum, file) => sum + file.progress, 0) / files.length)
  },

  /**
   * Coordinates SSE event handling and state updates
   */
  coordinateSSEEvents: (sessionId: string) => {
    // Connect SSE and ensure proper event handling
    get().connectSSE(sessionId)

    // Update session progress periodically
    const updateProgress = () => {
      const progress = get().calculateOverallProgress(sessionId)
      get().updateSessionProgress(sessionId, progress)
    }

    // Set up progress monitoring
    const progressInterval = setInterval(updateProgress, 1000)

    // Store cleanup function
    set((state) => {
      const session = state.sessions[sessionId]
      if (session?.sseConnection) {
        const existingCleanup = session.sseConnection.cleanup
        session.sseConnection.cleanup = () => {
          clearInterval(progressInterval)
          existingCleanup?.()
        }
      }
    })
  },

  /**
   * Handles API response and updates state accordingly
   */
  handleAPIResponse: (response: any, sessionId: string) => {
    if (response.success) {
      // Update session status to completed if all files succeeded
      const session = get().sessions[sessionId]
      if (session) {
        const allCompleted = session.fileIds.every((fileId) => {
          const file = get().files[fileId]
          return file?.status === 'completed'
        })

        if (allCompleted) {
          set((state) => {
            const sess = state.sessions[sessionId]
            if (sess) {
              sess.status = 'completed'
              sess.updatedAt = new Date()
              sess.overallProgress = 100
            }
          })
        }
      }
    } else {
      // Handle API errors
      if (response.errors) {
        response.errors.forEach((error: any) => {
          get().addError({
            message: error.message || error.error || 'Upload failed',
            fileId: error.fileId,
            sessionId,
            recoverable: true,
          })
        })
      }
    }
  },

  /**
   * Presigned upload flow - uploads files directly to storage
   * Uses per-file presigned sessions and direct storage uploads
   */
  startUpload: async (): Promise<BatchUploadResult> => {
    const { activeSessionId, sessions, files, addError, entityConfig, config } = get()
    const maxConcurrency = Math.max(1, config?.maxConcurrentUploads ?? 3)

    // Get session or lazily create one
    const sessionId = activeSessionId
    const session = sessionId ? sessions[sessionId] : null

    // Gather files eligible to upload (pending or failed) from the store
    const allFiles = Object.values(files)
    const fileIdsToAttach = allFiles
      .filter((f) => f && (f.status === 'pending' || f.status === 'failed'))
      .map((f) => f.id)

    if (!session) {
      // No fallback to global config - require explicit session creation
      addError({
        message:
          'Cannot start upload: No active session. The upload session should be created automatically when files are added. Please try adding files again.',
        code: 'NO_ACTIVE_SESSION',
        recoverable: true,
        details: {
          activeSessionId,
          fileCount: fileIdsToAttach.length,
          hint: 'This usually happens when session creation failed. Check console for errors.',
        },
      })
      console.error(
        'startUpload called without active session. Sessions must be created explicitly via createSession().'
      )
      return { totalFiles: 0, successCount: 0, failedCount: 0, results: [], overallProgress: 0 }
    }

    // Get files to upload from session
    const toUpload = session.fileIds
      .map((id) => get().files[id])
      .filter((f) => f && (f.status === 'pending' || f.status === 'failed'))

    if (toUpload.length === 0) {
      addError({ message: 'No files to upload', code: 'NO_FILES', recoverable: true })
      return { totalFiles: 0, successCount: 0, failedCount: 0, results: [], overallProgress: 0 }
    }

    set((state) => {
      state.uploading = true
    })

    // Simple concurrency pool
    let fileIndex = 0
    const successes: string[] = []
    const failures: Array<{ id: string; error: string }> = []

    const processNextFile = async (): Promise<void> => {
      while (true) {
        const file = toUpload[fileIndex++]
        if (!file?.file) return

        try {
          // 1. Create presigned session (per file)
          const createResponse = await fetch('/api/files/upload/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.mimeType || file.file?.type || 'application/octet-stream',
              expectedSize: file.size,
              provider: 'S3', // ✅ Use correct credential provider ID
              entityType: session.entityType, // ✅ Move to root level for API validation
              entityId: session.entityId, // ✅ Move to root level for API validation
              // Forward client session metadata to server
              metadata: session.metadata || {},
            }),
          })

          if (!createResponse.ok) {
            throw new Error(`Session create failed (${createResponse.status})`)
          }

          const presignedConfig = (await createResponse.json()) as {
            sessionId: string
            uploadMethod: 'single' | 'multipart'
            uploadType?: 'PUT' | 'POST'
            presignedUrl?: string
            presignedFields?: Record<string, string>
            uploadId?: string
            partPresignEndpoint?: string
            storageKey: string
          }

          // Store server-side session ID for SSE correlation
          set((state) => {
            const fs = state.files[file.id]
            if (fs) fs.serverFileId = presignedConfig.sessionId // helps SSE correlation later
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

          const { abort, promise } = directUpload({
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
          const completeResponse = await fetch(
            `/api/files/upload/${presignedConfig.sessionId}/complete`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                storageKey: presignedConfig.storageKey, // Use storage key from session creation
                size: file.size,
                mimeType: file.mimeType || file.file?.type || 'application/octet-stream',
                etag: uploadResult.etag,
                uploadId: uploadResult.uploadId,
                parts: uploadResult.parts,
              }),
            }
          )

          if (!completeResponse.ok) {
            throw new Error(`Complete failed (${completeResponse.status})`)
          }

          // Parse completion data to capture assetId/url for downstream consumers
          let completionData: any = null
          try {
            completionData = await completeResponse.json()
            console.log('[orchestration] Complete response:', completionData)
          } catch (e) {
            console.error('[orchestration] Failed to parse complete response:', e)
          }

          // Atomic update: set serverFileId, url, and status together
          // This prevents race conditions where onComplete reads state before serverFileId is set
          set((state) => {
            const f = state.files[file.id]
            if (f) {
              // Store assetId from server as serverFileId
              if (completionData?.assetId) {
                f.serverFileId = completionData.assetId
              }
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
          get().addError({
            message,
            fileId: file.id,
            sessionId: sessionId!,
            recoverable: true,
          })
          get().updateFileStatus(file.id, 'failed')
          failures.push({ id: file.id, error: message })
          get().clearInFlight(file.id)
        }
      }
    }

    // Start concurrent processing pool
    const poolSize = Math.min(maxConcurrency, toUpload.length)
    await Promise.all(new Array(poolSize).fill(0).map(() => processNextFile()))

    // Finalize
    set((state) => {
      state.uploading = false
    })

    const finalFiles = session.fileIds.map((id) => get().files[id]).filter(Boolean)
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
      overallProgress: get().calculateOverallProgress(sessionId!),
    }
  },

  /**
   * Upload with concurrency guard - uploads files for a specific session
   */
  startUploadForSession: async (sessionId: string): Promise<BatchUploadResult> => {
    // Check if upload is already in progress for this session
    const existingPromise = uploadPromises.get(sessionId)
    if (existingPromise) {
      console.log('[startUploadForSession] Upload already in progress, returning existing promise')
      return existingPromise
    }

    const uploadPromise = (async () => {
      try {
        // Mark session as uploading (per-session state)
        set((state) => {
          const session = state.sessions[sessionId]
          if (session) {
            session.uploading = true
            session.uploadStartTime = Date.now()
          }
        })

        // Get files for this session
        const freshState = get()
        const session = freshState.sessions[sessionId]
        if (!session) {
          throw new Error('Session not found')
        }

        const filesToUpload = session.fileIds
          .map((id) => freshState.files[id])
          .filter((f) => f && (f.status === 'pending' || f.status === 'failed'))

        if (filesToUpload.length === 0) {
          return {
            totalFiles: 0,
            successCount: 0,
            failedCount: 0,
            results: [],
            overallProgress: 0,
          }
        }

        // Use the existing startUpload logic but scoped to this session
        const currentActiveSession = freshState.activeSessionId

        // Temporarily set this session as active for startUpload
        set((state) => {
          state.activeSessionId = sessionId
        })

        try {
          const result = await get().startUpload()

          // Store result in session for future reference
          set((state) => {
            const session = state.sessions[sessionId]
            if (session) {
              session.uploading = false
              session.uploadResult = result
            }
          })

          return result
        } finally {
          // Restore previous active session if different
          if (currentActiveSession !== sessionId) {
            set((state) => {
              state.activeSessionId = currentActiveSession
            })
          }
        }
      } catch (error) {
        // Handle error
        set((state) => {
          const session = state.sessions[sessionId]
          if (session) {
            session.uploading = false
            session.uploadError = error instanceof Error ? error.message : 'Upload failed'
          }
        })

        throw error
      } finally {
        // Clear the promise
        uploadPromises.delete(sessionId)
      }
    })()

    // Store the promise
    uploadPromises.set(sessionId, uploadPromise)

    return uploadPromise
  },

  /**
   * Enhanced upload cancellation with per-file abort tracking
   */
  cancelUpload: () => {
    const { activeSessionId, sessions, inFlight } = get()

    // Abort all in-flight uploads (per-file)
    Object.values(inFlight).forEach((handle) => handle.abort?.())
    set((state) => {
      state.inFlight = {}
    })

    if (activeSessionId && sessions[activeSessionId]) {
      // Cancel all files in session
      sessions[activeSessionId].fileIds.forEach((fileId) => {
        get().cancelFile(fileId)
      })

      // Update session status
      set((state) => {
        const session = state.sessions[activeSessionId]
        if (session) {
          session.status = 'cancelled'
          session.updatedAt = new Date()
        }
      })

      // Disconnect SSE
      get().disconnectSSE(activeSessionId)
    }

    set((state) => {
      state.uploading = false
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

    // Restart upload if this is the active session
    if (sessionId === get().activeSessionId) {
      await get().startUpload()
    }
  },

  /**
   * Clean up session resources
   */
  cleanupSession: (sessionId: string) => {
    // Disconnect SSE
    get().disconnectSSE(sessionId)

    // Clean up any timers or intervals
    const session = get().sessions[sessionId]
    if (session?.sseConnection?.cleanup) {
      session.sseConnection.cleanup()
    }
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
