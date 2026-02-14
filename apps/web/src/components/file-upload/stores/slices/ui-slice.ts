// apps/web/src/components/file-upload/stores/slices/ui-slice.ts

import { produce } from 'immer'
import type { StateCreator } from 'zustand'
import type { UploadConfig, UploadError, UploadStore } from '../types'

export interface UISlice {
  dragActive: boolean
  uploading: boolean
  errors: UploadError[]
  config: UploadConfig
  recentErrorHashes: Record<string, number>

  setDragActive: (active: boolean) => void
  setUploading: (uploading: boolean) => void
  clearQueue: () => void
  addError: (error: Omit<UploadError, 'id' | 'timestamp'>) => void
  removeError: (errorId: string) => void
  clearErrors: () => void
  updateConfig: (config: Partial<UploadConfig>) => void
  reset: () => void
  cleanup: () => void

  // SSE Integration methods
  updateFromSSEEvent: (event: any) => void
  syncQueueWithSSE: (sessionId: string) => void
  handleSSEError: (error: any, sessionId?: string) => void
  // REMOVED: paused, setPaused, pauseUpload, resumeUpload (offline functionality)
}

const defaultConfig: UploadConfig = {
  maxConcurrentUploads: 3,
  chunkSize: 1024 * 1024, // 1MB
  showThumbnails: true,
  confirmBeforeCancel: true,
  // REMOVED: autoRetry, maxRetryAttempts (offline retry functionality)
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export const createUISlice: StateCreator<UploadStore, [], [], UISlice> = (set, get) => ({
  dragActive: false,
  uploading: false,
  errors: [],
  config: defaultConfig,
  recentErrorHashes: {},

  setDragActive: (active: boolean) => {
    set((state) => {
      state.dragActive = active
    })
  },

  setUploading: (uploading: boolean) => {
    set((state) => {
      state.uploading = uploading
    })
  },

  clearQueue: () => {
    set(
      produce((state) => {
        // Clear all files and queue
        state.files = {}
        state.queue = []

        // Clear file references from all sessions
        Object.values(state.sessions).forEach((session) => {
          session.fileIds = []
          session.updatedAt = new Date()
        })
      })
    )
  },

  addError: (error: Omit<UploadError, 'id' | 'timestamp'>) => {
    const key = `${error.code || ''}|${error.fileId || ''}|${error.sessionId || ''}|${error.message}`
    const now = Date.now()
    const seenAt = get().recentErrorHashes[key]

    // Ignore repeats within 60s
    if (seenAt && now - seenAt < 60_000) return

    set(
      produce((state) => {
        state.recentErrorHashes[key] = now
        const newError: UploadError = {
          ...error,
          id: generateId('error'),
          timestamp: new Date(),
          recoverable: !!error.recoverable,
        }
        state.errors.push(newError)

        // Limit error history to prevent memory issues
        if (state.errors.length > 50) {
          state.errors = state.errors.slice(-50)
        }
      })
    )
  },

  removeError: (errorId: string) => {
    set(
      produce((state) => {
        const index = state.errors.findIndex((e) => e.id === errorId)
        if (index > -1) {
          state.errors.splice(index, 1)
        }
      })
    )
  },

  clearErrors: () => {
    set((state) => {
      state.errors = []
      // Clear dedupe map so new errors can show later
      state.recentErrorHashes = {}
    })
  },

  updateConfig: (config: Partial<UploadConfig>) => {
    set((state) => {
      state.config = { ...state.config, ...config }
    })
  },

  reset: () => {
    set(
      produce((state) => {
        // Reset all state to initial values
        state.sessions = {}
        state.activeSessionId = null
        state.files = {}
        state.queue = []
        state.dragActive = false
        state.uploading = false
        state.errors = []

        // Keep config but reset error deduplication and SSE connections
        state.recentErrorHashes = {}

        // Properly cleanup SSE connections
        Object.values(state.sseConnections).forEach((connection) => {
          connection.manager?.disconnect() // ✅ Use manager, not eventSource
          connection.cleanup?.()
        })
        state.sseConnections = {}
      })
    )
  },

  cleanup: () => {
    set(
      produce((state) => {
        // Close all SSE connections
        Object.values(state.sseConnections).forEach((connection) => {
          connection.manager?.disconnect() // ✅ Use manager, not eventSource
          connection.cleanup?.()
        })
        state.sseConnections = {}

        // Sessions are now runtime-only, no expiration cleanup needed

        // Clear old errors (older than 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
        state.errors = state.errors.filter((error) => error.timestamp > oneHourAgo)
      })
    )
  },

  // SSE Integration methods
  updateFromSSEEvent: (event: any) => {
    set(
      produce((state) => {
        switch (event.type) {
          case 'upload-started':
            state.uploading = true
            break

          case 'upload-completed':
          case 'all_uploads_completed':
            state.uploading = false
            break

          case 'error':
            // Add SSE errors to error list
            if (event.data.error) {
              const newError: UploadError = {
                id: generateId('sse_error'),
                message: event.data.error,
                timestamp: new Date(),
                fileId: event.data.fileId,
                sessionId: event.data.sessionId,
                type: 'upload',
                retryable: event.data.retryable || false,
              }
              state.errors.push(newError)
            }
            break

          case 'connection-lost':
            // Handle SSE connection issues
            state.errors.push({
              id: generateId('connection_error'),
              message: 'Connection to server lost. Attempting to reconnect...',
              timestamp: new Date(),
              type: 'connection',
              retryable: true,
            })
            break
        }
      })
    )
  },

  syncQueueWithSSE: (sessionId: string) => {
    set(
      produce((state) => {
        // Reset upload states to sync with server
        const session = state.sessions[sessionId]
        if (session) {
          // Clear any upload-related UI states when syncing
          state.uploading = false

          // Clear connection-related errors since we're reconnecting
          state.errors = state.errors.filter((error) => error.type !== 'connection')
        }
      })
    )
  },

  handleSSEError: (error: any, sessionId?: string) => {
    set(
      produce((state) => {
        const newError: UploadError = {
          id: generateId('sse_error'),
          message: error.message || 'SSE connection error',
          timestamp: new Date(),
          sessionId,
          recoverable: true,
        }
        state.errors.push(newError)

        // Reset upload states on SSE errors
        state.uploading = false
      })
    )
  },
})
