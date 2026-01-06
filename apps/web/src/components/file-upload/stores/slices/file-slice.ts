// apps/web/src/components/file-upload/stores/slices/file-slice.ts

import type { StateCreator } from 'zustand'
import type { UploadStore, FileState } from '../types'
import type { UploadProgress, EntityType } from '@auxx/lib/files/types'
import { getEntityConfig } from '@auxx/lib/files/types'
import { generateId } from '@auxx/utils/generateId'

export interface FileSlice {
  files: Record<string, FileState>
  queue: string[]
  fileIdToSessionId: Record<string, string>

  addFiles: (files: File[], sessionId?: string) => string[]
  removeFile: (fileId: string) => void
  removeFiles: (fileIds: string[]) => void
  updateFileProgress: (fileId: string, progress: Partial<UploadProgress>) => void
  updateFileStatus: (fileId: string, status: FileState['status']) => void
  setFileError: (fileId: string, error: string) => void
  cancelFile: (fileId: string) => void
  retryFile: (fileId: string) => void
}

export const createFileSlice: StateCreator<
  UploadStore,
  [['zustand/immer', never], ['zustand/devtools', never]],
  [],
  FileSlice
> = (set, get) => ({
  files: {},
  queue: [],
  fileIdToSessionId: {},

  addFiles: (files: File[], sessionId?: string, entityType?: EntityType) => {
    const { activeSessionId, sessions } = get()
    const targetSessionId = sessionId || activeSessionId

    const newIds: string[] = []

    set((state) => {
      const session = targetSessionId ? state.sessions[targetSessionId] : undefined
      // Use FILE as fallback if no session or entityType
      const entityType: EntityType = session?.entityType || 'FILE'

      for (const file of files) {
        // Dedupe by name+size+type
        const exists = Object.values(state.files).some(
          (f) => f.name === file.name && f.size === file.size && f.type === file.type
        )
        if (exists) continue

        const id = generateId()
        const tempFileId = generateId('temp')

        // Initialize stages from entity config (now with validated entityType)
        const entityConfig = getEntityConfig(entityType)
        const stages = entityConfig.stages.map((stageConfig) => ({
          name: stageConfig.name,
          displayName: stageConfig.displayName,
          progress: 0,
          status: 'pending' as const,
        }))

        const fileState: FileState = {
          id,
          tempFileId,
          file,
          name: file.name,
          size: file.size,
          displaySize: file.size, // Add displaySize for consistent interface
          type: 'file' as const, // Always 'file' for uploads
          mimeType: file.type, // Map file.type to mimeType
          ext: file.name.split('.').pop()?.toLowerCase() || null, // Extract extension
          createdAt: new Date(),
          updatedAt: new Date(),
          path: '/', // Default path, will be updated based on target folder
          parentId: session?.entityId || null, // Use session's target folder
          metadata: { targetFolderId: session?.entityId || null }, // Store target folder in metadata for integration
          isArchived: false,
          isUploading: true, // Always true for upload files
          tempId: tempFileId, // Alias for tempFileId
          entityType,
          status: 'pending',
          progress: 0,
          stages,
        }

        state.files[id] = fileState
        state.queue.push(id)
        newIds.push(id)

        // Update reverse mapping
        if (targetSessionId) {
          state.fileIdToSessionId[id] = targetSessionId
        }
      }

      // Add files to session
      if (session && newIds.length) {
        session.fileIds.push(...newIds)
        session.updatedAt = new Date()
      }
    })

    return newIds
  },

  removeFile: (fileId: string) => {
    set((state) => {
      // Remove from files
      delete state.files[fileId]

      // Remove from queue
      const queueIndex = state.queue.indexOf(fileId)
      if (queueIndex > -1) {
        state.queue.splice(queueIndex, 1)
      }

      // Fast removal from session using reverse mapping
      const sessionId = state.fileIdToSessionId[fileId]
      if (sessionId && state.sessions[sessionId]) {
        const session = state.sessions[sessionId]
        const fileIndex = session.fileIds.indexOf(fileId)
        if (fileIndex > -1) {
          session.fileIds.splice(fileIndex, 1)
          session.updatedAt = new Date()
        }
        delete state.fileIdToSessionId[fileId]
      } else {
        // Fallback: remove from active session only to avoid O(n*m)
        if (state.activeSessionId) {
          const session = state.sessions[state.activeSessionId]
          if (session) {
            const fileIndex = session.fileIds.indexOf(fileId)
            if (fileIndex > -1) {
              session.fileIds.splice(fileIndex, 1)
              session.updatedAt = new Date()
            }
          }
        }
      }
    })
  },

  removeFiles: (fileIds: string[]) => {
    set((state) => {
      const sessionsToUpdate = new Set<string>()

      for (const fileId of fileIds) {
        // Remove from files
        delete state.files[fileId]

        // Remove from queue
        const queueIndex = state.queue.indexOf(fileId)
        if (queueIndex > -1) {
          state.queue.splice(queueIndex, 1)
        }

        // Track sessions to update
        const sessionId = state.fileIdToSessionId[fileId]
        if (sessionId) {
          sessionsToUpdate.add(sessionId)
          delete state.fileIdToSessionId[fileId]
        }
      }

      // Update sessions in batch
      for (const sessionId of sessionsToUpdate) {
        const session = state.sessions[sessionId]
        if (session) {
          session.fileIds = session.fileIds.filter((id) => !fileIds.includes(id))
          session.updatedAt = new Date()
        }
      }
    })
  },

  updateFileProgress: (fileId: string, progress: Partial<UploadProgress>) => {
    set((state) => {
      const file = state.files[fileId]
      if (!file) return

      // Only mutate provided fields - use proper null checks
      if (typeof progress.overallProgress === 'number') {
        file.progress = Math.max(0, Math.min(100, progress.overallProgress))

        // Explicit status transitions based on progress
        if (progress.overallProgress >= 100) {
          file.status = 'completed'
        } else if (progress.overallProgress > 0 && file.status === 'pending') {
          file.status = 'uploading'
        }
      }

      // Update stages if provided
      if (progress.stages) {
        file.stages = progress.stages
      }

      // Update metadata only if explicitly provided
      if (progress.url !== undefined) file.url = progress.url
      if (progress.checksum !== undefined) file.checksum = progress.checksum

      // Handle upload progress separately
      if (typeof progress.uploadProgress === 'number' && file.status === 'uploading') {
        // Could track separate upload vs processing progress if needed
      }

      // Optional metadata from server
      if ((progress as any).serverFileId) {
        file.serverFileId = (progress as any).serverFileId
      }
    })
  },

  updateFileStatus: (fileId: string, status: FileState['status']) => {
    set((state) => {
      const file = state.files[fileId]
      if (!file) return

      file.status = status

      // Explicit status transitions
      switch (status) {
        case 'completed':
          file.progress = 100
          file.error = undefined
          break
        case 'failed':
          // Keep progress as-is; it's informative
          // Caller should also set error in progress or separately
          break
        case 'uploading':
          if (file.progress === 0) file.progress = 1
          break
        case 'cancelled':
          // Leave progress as-is; it's informative
          break
        case 'pending':
          file.progress = 0
          file.error = undefined
          break
        case 'processing':
          // No-op beyond status - processing updates come via updateFileProgress
          break
      }
    })
  },

  setFileError: (fileId: string, error: string) => {
    set((state) => {
      const file = state.files[fileId]
      if (file) {
        file.error = error
        file.status = 'failed'
      }
    })
  },

  cancelFile: (fileId: string) => {
    set((state) => {
      const file = state.files[fileId]
      if (file && file.status !== 'completed') {
        file.status = 'cancelled'
        // Keep current progress but mark as cancelled
      }
    })
  },

  retryFile: (fileId: string) => {
    set((state) => {
      const file = state.files[fileId]
      if (file && (file.status === 'failed' || file.status === 'cancelled')) {
        file.status = 'pending'
        file.progress = 0
        file.error = undefined
        // Reset stages to pending
        if (file.stages) {
          file.stages.forEach((stage) => {
            stage.status = 'pending'
            stage.progress = 0
          })
        }
      }
    })
  },
})
