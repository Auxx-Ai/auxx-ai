// apps/web/src/components/file-upload/stores/slices/session-slice.ts

import { ENTITY_TYPES } from '@auxx/lib/files/types'
import { generateId } from '@auxx/utils/generateId'
import type { StateCreator } from 'zustand'
import type { CreateSessionOptions, SessionState, UploadStore } from '../types'

/**
 * Session slice: the client-side session container and its lifecycle.
 */
export interface SessionSlice {
  // Session Management
  sessions: Record<string, SessionState>
  activeSessionId: string | null

  // Session Actions
  createSession: (options: CreateSessionOptions) => Promise<string>
  selectSession: (sessionId: string) => void
  closeSession: (sessionId: string) => void
  updateSessionProgress: (sessionId: string, progress: number) => void
}

export const createUnifiedSessionSlice: StateCreator<
  UploadStore,
  [['zustand/immer', never], ['zustand/devtools', never]],
  [],
  SessionSlice
> = (set, get) => ({
  sessions: {},
  activeSessionId: null,
  pendingFileIds: {}, // Initialize new field
  uploaderSessions: {}, // Initialize new field

  /**
   * Creates a new upload session - now client-only container
   * Actual presigned sessions are created per-file in startUpload
   */
  createSession: async (options: CreateSessionOptions) => {
    try {
      // Import ENTITY_TYPES for validation

      // Validate and fallback entityType
      let validatedEntityType = options.entityType
      if (!validatedEntityType || !(validatedEntityType in ENTITY_TYPES)) {
        console.warn(
          `Invalid entity type "${options.entityType}". Falling back to FILE.`,
          'Valid types:',
          Object.keys(ENTITY_TYPES)
        )
        validatedEntityType = ENTITY_TYPES.FILE
      }

      // Create client-side session container only
      // Actual presigned sessions are created per-file in startUpload
      const sessionId = generateId()

      const session: SessionState = {
        id: sessionId,
        entityType: validatedEntityType,
        entityId: options.entityId,

        // Store all configurations at session level
        validationConfig: options.validationConfig || {},
        behaviorConfig: options.behaviorConfig || {},
        callbacks: options.callbacks || {},
        uploadConfig: options.uploadConfig || {},

        status: 'created',
        fileIds: [],
        overallProgress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          ...options.metadata,
          source: options.metadata?.source || 'unknown',
        },
      }

      set((state) => {
        state.sessions[sessionId] = session
        state.activeSessionId = sessionId

        // DEPRECATED: Still set global config for backward compatibility
        // Will be removed in future update
        state.entityConfig = {
          entityType: options.entityType,
          entityId: options.entityId,
          metadata: options.metadata || {},
        }
        return state
      })

      // Add files if provided, properly linked to session
      if (options.files?.length) {
        const fileIds = get().addFiles(options.files, sessionId, options.entityType)

        // Update session with file IDs
        set((state) => {
          const session = state.sessions[sessionId]
          if (session) {
            session.fileIds = fileIds
          }
          return state
        })
      }

      return sessionId
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create session'
      get().addError({ message: errorMessage, code: 'SESSION_CREATE_FAILED', recoverable: true })
      throw error
    }
  },

  /**
   * Selects an active session
   */
  selectSession: (sessionId: string) => {
    set((state) => {
      if (state.sessions[sessionId]) {
        state.activeSessionId = sessionId
      }
      return state
    })
  },

  /**
   * Closes a session
   */
  closeSession: (sessionId: string) => {
    set((state) => {
      // Remove session
      delete state.sessions[sessionId]

      // Clear active session if it was the closed one
      if (state.activeSessionId === sessionId) {
        const remainingSessions = Object.keys(state.sessions)
        state.activeSessionId = remainingSessions[0] ?? null
      }
      return state
    })
  },

  /**
   * Updates session progress and timestamp
   */
  updateSessionProgress: (sessionId: string, progress: number) => {
    set((state) => {
      const session = state.sessions[sessionId]
      if (session) {
        session.overallProgress = Math.max(0, Math.min(100, progress))
        session.updatedAt = new Date()
      }
      return state
    })
  },
})
