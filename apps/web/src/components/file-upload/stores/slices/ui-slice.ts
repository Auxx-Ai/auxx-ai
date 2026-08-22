// apps/web/src/components/file-upload/stores/slices/ui-slice.ts

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

export const createUISlice: StateCreator<
  UploadStore,
  [['zustand/immer', never], ['zustand/devtools', never]],
  [],
  UISlice
> = (set, get) => ({
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
    set((state) => {
      // Clear all files and queue
      state.files = {}
      state.queue = []

      // Clear file references from all sessions
      Object.values(state.sessions).forEach((session) => {
        session.fileIds = []
        session.updatedAt = new Date()
      })
    })
  },

  addError: (error: Omit<UploadError, 'id' | 'timestamp'>) => {
    const key = `${error.code || ''}|${error.fileId || ''}|${error.sessionId || ''}|${error.message}`
    const now = Date.now()
    const seenAt = get().recentErrorHashes[key]

    // Ignore repeats within 60s
    if (seenAt && now - seenAt < 60_000) return

    set((state) => {
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
  },

  removeError: (errorId: string) => {
    set((state) => {
      const index = state.errors.findIndex((e) => e.id === errorId)
      if (index > -1) {
        state.errors.splice(index, 1)
      }
    })
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
    set((state) => {
      // Reset all state to initial values
      state.sessions = {}
      state.activeSessionId = null
      state.files = {}
      state.queue = []
      state.dragActive = false
      state.uploading = false
      state.errors = []

      // Keep config but reset error deduplication
      state.recentErrorHashes = {}
    })
  },

  cleanup: () => {
    set((state) => {
      // Sessions are now runtime-only, no expiration cleanup needed

      // Clear old errors (older than 1 hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      state.errors = state.errors.filter((error) => error.timestamp > oneHourAgo)
    })
  },
})
