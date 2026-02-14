'use client'

import type { BatchUploadResult, EntityType } from '@auxx/lib/files/types'
import { generateId } from '@auxx/utils/generateId'
import * as React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cleanupUploader, useUploadStore } from '../stores'
import type { EntityUploadConfig, FileState } from '../types'

export interface UseFileUploadOptions {
  entityType: EntityType
  entityId?: string
  /** Optional metadata to include on the upload session; forwarded to server */
  sessionMetadata?: Record<string, any>

  // Validation options
  maxFiles?: number
  maxFileSize?: number
  fileExtensions?: string[]
  allowedMimeTypes?: string[]

  // Behavior options
  allowMultiple?: boolean
  autoStart?: boolean
  /**
   * @deprecated This option is no longer needed. Session creation happens automatically when required.
   * This option will be removed in the next major version.
   */
  autoCreateSession?: boolean
  confirmBeforeCancel?: boolean
  showThumbnails?: boolean

  // Upload config
  config?: Partial<EntityUploadConfig>

  // Callbacks
  onComplete?: (results: BatchUploadResult) => void
  onError?: (error: string) => void
  onProgress?: (progress: BatchUploadResult) => void
  onChange?: (files: FileState[]) => void

  initialFiles?: File[]
}

export interface UseFileUploadReturn {
  // Expose uploaderId for debugging
  uploaderId: string
  // State
  files: Array<{
    id: string
    name: string
    size: number
    type: string
    status:
      | 'pending'
      | 'uploading'
      | 'processing'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'deleting'
    progress: number
    error?: string
    url?: string
    serverFileId?: string
  }>
  uploadSummary: {
    totalFiles: number
    completedFiles: number
    failedFiles: number
    pendingFiles: number
    overallProgress: number
    uploading: boolean
  } | null
  isUploading: boolean
  sessionId: string | null
  errors: Array<{
    id: string
    message: string
    fileId?: string
    recoverable: boolean
  }>

  // Actions
  addFiles: (files: File[]) => Promise<string[]>
  removeFile: (fileId: string) => void
  startUpload: () => Promise<BatchUploadResult>
  cancelUpload: () => void
  retry: (fileId?: string) => Promise<void>
  clearErrors: () => void

  // Session
  createNewSession: () => Promise<string>
  closeSession: () => void

  // Utility
  reset: () => void
}

/**
 * Trimmed hook:
 * - No internal retry loops or complex init state
 * - No toasts here (keep in store/UI)
 * - Calls onProgress and onComplete exactly once per session completion
 */
export function useFileUpload(options: UseFileUploadOptions): UseFileUploadReturn {
  const {
    entityType,
    entityId,
    sessionMetadata,
    // Validation options
    maxFiles,
    maxFileSize,
    fileExtensions,
    allowedMimeTypes,
    // Behavior options
    allowMultiple = true,
    autoStart = false,
    autoCreateSession = false,
    confirmBeforeCancel = false,
    showThumbnails = true,
    // Config and callbacks
    config,
    onComplete,
    onError,
    onProgress,
    onChange,
    initialFiles = [],
  } = options

  // Generate unique uploaderId for this hook instance (SSR-safe)
  // Using useState ensures the ID is consistent across SSR/hydration
  const [uploaderId] = React.useState(() => generateId('uploader'))

  // Single useUploadStore call with useShallow to avoid infinite loops
  const {
    uploaderSession,
    activeSessionId,
    sessions,
    filesMap,
    errors,
    isUploading,
    createSession,
    createSessionWithGuard,
    closeSession,
    addFilesWithValidation,
    removeFile,
    startUpload,
    cancelUpload,
    retryFile,
    retrySession,
    startUploadForSession,
    clearErrors,
    reset,
  } = useUploadStore(
    useShallow((state) => ({
      // State
      uploaderSession: state.uploaderSessions?.[uploaderId],
      activeSessionId: state.uploaderSessions?.[uploaderId] || state.activeSessionId,
      sessions: state.sessions,
      filesMap: state.files,
      errors: state.errors,
      isUploading: state.uploading,
      // Actions
      createSession: state.createSession,
      createSessionWithGuard: state.createSessionWithGuard,
      closeSession: state.closeSession,
      addFilesWithValidation: state.addFilesWithValidation,
      removeFile: state.removeFile,
      startUpload: state.startUpload,
      cancelUpload: state.cancelUpload,
      retryFile: state.retryFile,
      retrySession: state.retrySession,
      startUploadForSession: state.startUploadForSession,
      clearErrors: state.clearErrors,
      reset: state.reset,
    }))
  )

  // Log deprecation warning once per component
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  React.useEffect(() => {
    if (autoCreateSession && process.env.NODE_ENV === 'development') {
      console.warn(
        '[useFileUpload] The autoCreateSession option is deprecated and will be removed in v2.0.0.\n' +
          'Session creation now happens automatically when needed. You can safely remove this option.\n' +
          'Migration: Remove autoCreateSession from your useFileUpload/useFileSelect options.\n' +
          'See: https://docs.example.com/migration/session-management'
      )
    }
  }, []) // Empty deps - run once

  // Session ref for lazy creation
  const sessionRef = React.useRef<string | null>(null)
  const [sessionInitialized, setSessionInitialized] = React.useState(false)

  // LAZY SESSION CREATION - Only create when actually needed
  const ensureSession = React.useCallback(async (): Promise<string> => {
    // Return existing session if available
    if (sessionRef.current && sessions[sessionRef.current]) {
      return sessionRef.current
    }

    // Check if uploader already has a session
    if (uploaderSession && sessions[uploaderSession]) {
      sessionRef.current = uploaderSession
      return uploaderSession
    }

    // Create session on-demand with proper entity type
    const validatedEntityType = entityType || 'FILE'
    const sessionId = await createSessionWithGuard(uploaderId, {
      entityType: validatedEntityType,
      entityId: entityId || generateId('entity'),
      validationConfig: {
        maxFiles,
        maxFileSize,
        fileExtensions,
        allowedMimeTypes,
      },
      behaviorConfig: {
        allowMultiple,
        autoStart: false, // Never auto-start in lazy creation
        confirmBeforeCancel,
        showThumbnails,
      },
      callbacks: {
        onComplete,
        onError,
        onProgress,
        onChange,
      },
      uploadConfig: config,
      metadata: {
        source: 'useFileUpload-lazy',
        uploaderId,
        createdAt: new Date().toISOString(),
        trigger: 'user-interaction', // Track that this was user-initiated
        ...(sessionMetadata || {}),
      },
    })

    sessionRef.current = sessionId
    setSessionInitialized(true)
    return sessionId
  }, [
    uploaderId,
    uploaderSession,
    sessions,
    createSessionWithGuard,
    entityType,
    entityId,
    maxFiles,
    maxFileSize,
    fileExtensions,
    allowedMimeTypes,
    allowMultiple,
    confirmBeforeCancel,
    showThumbnails,
    onComplete,
    onError,
    onProgress,
    onChange,
    config,
    sessionMetadata,
  ])

  // Build arrays used by UI
  const session = activeSessionId ? sessions[activeSessionId] : undefined
  const sessionFiles = session?.fileIds.map((id) => filesMap[id]).filter(Boolean) ?? []
  const allFiles = Object.values(filesMap)

  // Prefer session files; fall back to all (lets user add before session exists)
  const filesForSummary = sessionFiles.length ? sessionFiles : allFiles

  const uploadSummary =
    filesForSummary.length > 0
      ? {
          totalFiles: filesForSummary.length,
          completedFiles: filesForSummary.filter((f) => f.status === 'completed').length,
          failedFiles: filesForSummary.filter((f) => f.status === 'failed').length,
          pendingFiles: filesForSummary.filter((f) => f.status === 'pending').length,
          overallProgress: Math.round(
            filesForSummary.reduce((sum, f) => sum + (f.progress || 0), 0) / filesForSummary.length
          ),
          uploading: isUploading,
        }
      : null

  const transformedFiles = (allFiles.length ? allFiles : filesForSummary).map((f) => ({
    id: f.id,
    name: f.name,
    size: f.displaySize || (f.size ? Number(f.size) : 0),
    type: f.type,
    mimeType: f.mimeType,
    file: f.file,
    status: f.status,
    progress: f.progress || 0,
    error: f.error,
    url: f.url,
    serverFileId: (f as any).serverFileId,
  }))

  const transformedErrors = errors.map((e) => ({
    id: e.id,
    message: e.message,
    fileId: e.fileId,
    recoverable: e.recoverable,
  }))

  // 5) Lightweight progress callback (no throttling; your UI is already efficient)
  // biome-ignore lint/correctness/useExhaustiveDependencies: using uploadSummary sub-properties for granular progress tracking; onProgress and filesForSummary are stable
  React.useEffect(() => {
    if (!onProgress || !uploadSummary || uploadSummary.totalFiles === 0) return

    const results = filesForSummary.map((f) => ({
      success: f.status === 'completed',
      fileId: f.id,
      filename: f.name,
      url: f.url,
      size: f.size,
      mimeType: f.type,
      error: f.error,
      metadata: { assetId: f.serverFileId || f.id },
    }))

    onProgress({
      totalFiles: uploadSummary.totalFiles,
      successCount: uploadSummary.completedFiles,
      failedCount: uploadSummary.failedFiles,
      results,
      overallProgress: uploadSummary.overallProgress,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    uploadSummary?.totalFiles,
    uploadSummary?.completedFiles,
    uploadSummary?.failedFiles,
    uploadSummary?.overallProgress,
  ])

  // 6) Fire onComplete once per session using the metadata flag
  // biome-ignore lint/correctness/useExhaustiveDependencies: using uploadSummary sub-properties for granular completion tracking
  React.useEffect(() => {
    if (!onComplete || !uploadSummary || uploadSummary.uploading) return
    const done =
      uploadSummary.totalFiles > 0 &&
      uploadSummary.completedFiles + uploadSummary.failedFiles === uploadSummary.totalFiles

    if (!done) return
    const id = useUploadStore.getState().activeSessionId
    if (!id) return

    const store = useUploadStore.getState()
    const sess = store.sessions[id]
    if (!sess) return

    if (sess.metadata.__notifiedComplete) return // already notified

    const results = (sess.fileIds || [])
      .map((fid) => store.files[fid])
      .filter(Boolean)
      .map((f) => ({
        success: f!.status === 'completed',
        fileId: f!.id,
        filename: f!.name,
        url: f!.url,
        size: f!.size,
        mimeType: f!.type,
        error: f!.error,
        metadata: { assetId: f!.serverFileId || f!.id },
      }))

    onComplete({
      totalFiles: uploadSummary.totalFiles,
      successCount: uploadSummary.completedFiles,
      failedCount: uploadSummary.failedFiles,
      results,
      overallProgress: uploadSummary.overallProgress,
    })

    // mark notified in store (proper Immer mutation)
    useUploadStore.setState((state) => {
      const s = state.sessions[id]
      if (s?.metadata) {
        s.metadata.__notifiedComplete = true
      }
    })
  }, [
    onComplete,
    uploadSummary?.uploading,
    uploadSummary?.totalFiles,
    uploadSummary?.completedFiles,
    uploadSummary?.failedFiles,
    uploadSummary?.overallProgress,
  ])

  // Actions

  const handleCreateNewSession = React.useCallback(async () => {
    return await createSession({
      entityType,
      entityId,
      // Pass all session-scoped configurations
      validationConfig: {
        maxFiles,
        maxFileSize,
        fileExtensions,
        allowedMimeTypes,
      },
      behaviorConfig: {
        allowMultiple,
        autoStart,
        autoCreateSession,
        confirmBeforeCancel,
        showThumbnails,
      },
      callbacks: {
        onComplete,
        onError,
        onProgress,
        onChange,
      },
      uploadConfig: config,
      metadata: {
        source: 'useFileUpload-newSession',
        ts: new Date().toISOString(),
        ...(sessionMetadata || {}),
      },
    })
  }, [
    createSession,
    entityType,
    entityId,
    maxFiles,
    maxFileSize,
    fileExtensions,
    allowedMimeTypes,
    allowMultiple,
    autoStart,
    autoCreateSession,
    confirmBeforeCancel,
    showThumbnails,
    onComplete,
    onError,
    onProgress,
    onChange,
    config,
    sessionMetadata,
  ])

  const handleAddFiles = React.useCallback(
    async (newFiles: File[]) => {
      // Ensure session exists using lazy creation
      const sessionId = await ensureSession()

      // Add files with validation, passing the sessionId
      const result = await addFilesWithValidation(newFiles, uploaderId, {
        maxFiles,
        maxFileSize,
        fileExtensions,
        allowedMimeTypes,
        sessionId, // Pass the sessionId we just ensured
      })

      // Handle validation errors
      if (result.validationErrors.length > 0) {
        onError?.(result.validationErrors.join('; '))
      }

      // Start upload if autoStart and we have a session and valid files
      if (autoStart && sessionId && result.addedFileIds.length > 0) {
        // Use queueMicrotask for predictable ordering
        queueMicrotask(() => startUploadForSession(sessionId))
      }

      return result.addedFileIds
    },
    [
      ensureSession,
      uploaderId,
      addFilesWithValidation,
      startUploadForSession,
      autoStart,
      maxFiles,
      maxFileSize,
      fileExtensions,
      allowedMimeTypes,
      onError,
    ]
  )

  const handleStartUpload = React.useCallback(async () => {
    // Ensure session exists using lazy creation
    const sessionId = await ensureSession()

    // Start upload with concurrency guard
    return await startUploadForSession(sessionId)
  }, [ensureSession, startUploadForSession])

  const handleRetry = React.useCallback(
    async (fileId?: string) => {
      if (fileId) {
        retryFile(fileId)
      } else if (activeSessionId) {
        await retrySession(activeSessionId)
      }
    },
    [retryFile, retrySession, activeSessionId]
  )

  const handleCloseSession = React.useCallback(() => {
    if (activeSessionId) closeSession(activeSessionId)
  }, [closeSession, activeSessionId])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      // Clean up uploader-specific data on unmount
      const state = useUploadStore.getState()
      const pendingIds = state.pendingFileIds?.[uploaderId]
      const sessionId = state.uploaderSessions?.[uploaderId]

      if (pendingIds && pendingIds.length > 0) {
        // Keep pending files (mark as error) for recovery - don't wipe
        console.warn(
          `[useFileUpload] Unmounting with ${pendingIds.length} pending files - keeping for recovery`
        )
      }

      // Clean up session mapping - using Immer properly
      useUploadStore.setState((state) => {
        // Immer draft - just mutate directly
        if (state.uploaderSessions) {
          delete state.uploaderSessions[uploaderId]
        }
        if (state.pendingFileIds) {
          delete state.pendingFileIds[uploaderId]
        }
        // No need to return anything with Immer
      })

      // Clean up module-level promises and abort controllers
      cleanupUploader(uploaderId)

      // If session was exclusive to this uploader, consider marking it for cleanup
      if (sessionId) {
        const session = state.sessions[sessionId]
        if (session && !session.uploading) {
          console.log(`[useFileUpload] Session ${sessionId} may be orphaned after unmount`)
        }
      }
    }
  }, [uploaderId])

  return {
    // Expose uploaderId for debugging
    uploaderId,
    files: transformedFiles,
    uploadSummary,
    isUploading,
    sessionId: session?.id || null,
    errors: transformedErrors,

    addFiles: handleAddFiles,
    removeFile,
    startUpload: handleStartUpload,
    cancelUpload,
    retry: handleRetry,
    clearErrors,

    createNewSession: handleCreateNewSession,
    closeSession: handleCloseSession,

    reset,
  }
}
