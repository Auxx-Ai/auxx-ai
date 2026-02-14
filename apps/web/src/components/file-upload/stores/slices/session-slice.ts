// apps/web/src/components/file-upload/stores/slices/session-slice.ts

import type { FileUploadEvent } from '@auxx/lib/files/types'
import { ENTITY_TYPES, FileUploadEventType } from '@auxx/lib/files/types'
import type { StateCreator } from 'zustand'
import { SSEConnectionManager } from '../../utils'
import type { CreateSessionOptions, SessionState, SSEConnectionState, UploadStore } from '../types'

/**
 * Session slice that combines session management and SSE functionality
 * This is the unified approach that replaces the old separate slices
 */
export interface SessionSlice {
  // Session Management
  sessions: Record<string, SessionState & { sseConnection?: SSEConnectionState }>
  activeSessionId: string | null

  // Session Actions
  createSession: (options: CreateSessionOptions) => Promise<string>
  selectSession: (sessionId: string) => void
  closeSession: (sessionId: string) => void
  updateSessionProgress: (sessionId: string, progress: number) => void

  // SSE Management (integrated)
  connectSSE: (sessionId: string) => void
  disconnectSSE: (sessionId: string) => void
  handleSSEEvent: (sessionId: string, event: FileUploadEvent) => void

  // SSE Connections (now part of session state)
  sseConnections: Record<string, SSEConnectionState & { manager?: SSEConnectionManager }>
}

export const createUnifiedSessionSlice: StateCreator<UploadStore, [], [], SessionSlice> = (
  set,
  get
) => ({
  sessions: {},
  activeSessionId: null,
  sseConnections: {},
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
      const sessionId = crypto.randomUUID()

      const session: SessionState & { sseConnection?: SSEConnectionState } = {
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
        sseConnection: {
          sessionId: sessionId,
          status: 'disconnected',
          reconnectAttempts: 0,
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

      // Do NOT auto-connect SSE here.
      // Rationale: This client-side session ID is not a server-side upload session ID.
      // Connecting SSE at this point causes a request to `/api/files/upload/{sessionId}/events`
      // with a non-existent server session, resulting in 404s. SSE should be connected
      // only after a real server upload session is created (per-file) during startUpload.
      // If/when SSE is required, connect using the server-provided sessionId returned
      // by `/api/files/upload/sessions`.

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
   * Closes a session and cleans up its SSE connection
   */
  closeSession: (sessionId: string) => {
    set((state) => {
      // Disconnect SSE properly
      get().disconnectSSE(sessionId)

      // Remove session
      delete state.sessions[sessionId]

      // Clear active session if it was the closed one
      if (state.activeSessionId === sessionId) {
        const remainingSessions = Object.keys(state.sessions)
        state.activeSessionId = remainingSessions.length > 0 ? remainingSessions[0] : null
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

  /**
   * Establishes SSE connection for a session
   */
  connectSSE: (sessionId: string) => {
    const { sseConnections } = get()

    // Don't connect if already connected
    if (sseConnections[sessionId]?.status === 'connected') {
      return
    }

    // Create SSE connection manager
    const manager = new SSEConnectionManager(sessionId, {
      autoConnect: false,
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
    })

    // Set up event handlers that integrate with Zustand store
    manager.setEventHandlers({
      onUploadProgress: (event) => get().handleSSEEvent(sessionId, event),
      onProcessingProgress: (event) => get().handleSSEEvent(sessionId, event),
      onUploadCompleted: (event) => get().handleSSEEvent(sessionId, event),
      onProcessingCompleted: (event) => get().handleSSEEvent(sessionId, event),
      onJobUpdate: (event) => get().handleSSEEvent(sessionId, event),
      onError: (event) => get().handleSSEEvent(sessionId, event),
      onSessionConnected: (event) => get().handleSSEEvent(sessionId, event),
      onAnyEvent: (event) => get().handleSSEEvent(sessionId, event),
    })

    // Store connection state
    set((state) => {
      state.sseConnections[sessionId] = {
        sessionId,
        status: 'connecting',
        reconnectAttempts: 0,
        manager,
      }

      // Also update session's SSE connection state
      const session = state.sessions[sessionId]
      if (session && session.sseConnection) {
        session.sseConnection.status = 'connecting'
        session.sseConnection.reconnectAttempts = 0
      }
      return state
    })

    // Listen to connection status changes
    const checkConnectionStatus = () => {
      const connectionStatus = manager.getConnectionStatus()
      set((state) => {
        const connection = state.sseConnections[sessionId]
        if (connection) {
          connection.status = connectionStatus.state
          connection.reconnectAttempts = connectionStatus.reconnectAttempts
          connection.error = connectionStatus.error
          connection.lastConnected = connectionStatus.lastConnected
        }

        // Sync with session state
        const session = state.sessions[sessionId]
        if (session && session.sseConnection) {
          session.sseConnection.status = connectionStatus.state
          session.sseConnection.reconnectAttempts = connectionStatus.reconnectAttempts
          session.sseConnection.error = connectionStatus.error
          session.sseConnection.lastConnected = connectionStatus.lastConnected
        }
        return state
      })
    }

    // Poll connection status
    const statusInterval = setInterval(checkConnectionStatus, 1000)

    // Store cleanup function
    set((state) => {
      const connection = state.sseConnections[sessionId]
      if (connection) {
        connection.cleanup = () => {
          clearInterval(statusInterval)
          manager.disconnect()
        }
      }
      return state
    })

    // Connect
    manager.connect()
  },

  /**
   * Disconnects SSE connection for a session
   */
  disconnectSSE: (sessionId: string) => {
    set((state) => {
      const connection = state.sseConnections[sessionId]
      if (connection) {
        // Let cleanup handle the actual disconnect
        connection.cleanup?.()

        // Update connection state
        connection.status = 'disconnected'
        connection.manager = undefined
        connection.cleanup = undefined
      }

      // Update session's SSE connection state
      const session = state.sessions[sessionId]
      if (session && session.sseConnection) {
        session.sseConnection.status = 'disconnected'
      }
      return state
    })
  },

  /**
   * Handles SSE events and updates file/session state accordingly
   * Updated for new event names: session-status, status-update
   */
  handleSSEEvent: (sessionId: string, event: FileUploadEvent) => {
    const { updateFileProgress, updateFileStatus, updateSessionProgress, addError } = get()

    console.log('🔔 SSE Event received:', {
      sessionId,
      eventType: event.event,
      data: event.data,
    })

    try {
      switch (event.event) {
        case 'session-status': // Custom event for session connection
        case FileUploadEventType.SESSION_CONNECTED: {
          // Session connected confirmation
          set((state) => {
            const session = state.sessions[sessionId]
            if (session && session.sseConnection) {
              session.sseConnection.status = 'connected'
              session.sseConnection.lastConnected = new Date()
            }

            const connection = state.sseConnections[sessionId]
            if (connection) {
              connection.status = 'connected'
              connection.lastConnected = new Date()
            }
            return state
          })
          break
        }

        case 'status-update': // Custom event for status updates
        case FileUploadEventType.STATUS_UPDATE: {
          const data = event.data as any

          // Update session progress for processing milestones
          if (typeof data.progress === 'number') {
            updateSessionProgress(sessionId, data.progress)
          }

          // Update session status if provided
          if (data.status) {
            set((state) => {
              const session = state.sessions[sessionId]
              if (session) {
                session.status = data.status
                session.updatedAt = new Date()
              }
              return state
            })
          }
          break
        }

        case 'processing-completed': // Custom event for processing completion
        case FileUploadEventType.PROCESSING_COMPLETED: {
          const data = event.data as any
          updateSessionProgress(sessionId, 100)

          // Process individual file results
          if (data.result?.uploadResults) {
            const uploadResults = data.result.uploadResults
            for (const result of uploadResults) {
              const files = Object.values(get().files)
              // Use consistent property name
              let file = files.find((f) => f.serverFileId === result.fileId)

              if (!file && result.fileName) {
                file = files.find((f) => f.name === result.fileName)
              }

              if (file) {
                updateFileStatus(file.id, 'completed')
                updateFileProgress(file.id, {
                  fileId: file.id,
                  filename: file.name,
                  overallProgress: 100,
                  status: 'completed',
                  completedAt: new Date(),
                  url: result.url,
                  checksum: result.checksum,
                  // Only set stages if we have actual stage data
                  // stages: result.stages || undefined
                })

                // Update file with server data
                set((state) => {
                  const fileState = state.files[file.id]
                  if (fileState) {
                    fileState.serverFileId = result.fileId // Consistent property
                    fileState.url = result.url
                    fileState.checksum = result.checksum
                  }
                  return state
                })
              }
            }
          }

          // Mark session as completed
          set((state) => {
            const session = state.sessions[sessionId]
            if (session) {
              session.status = 'completed'
              session.completedAt = new Date()
              session.updatedAt = new Date()
              session.metadata.__notifiedComplete = session.metadata.__notifiedComplete ?? false
            }
            return state
          })
          break
        }

        case FileUploadEventType.ERROR: {
          const data = event.data as any
          addError({
            message: data.error || 'Processing error',
            code: data.code,
            fileId: data.fileId,
            sessionId,
            recoverable: data.recoverable || false,
          })
          break
        }

        default:
          console.log('Unhandled SSE event:', event.event, event.data)
      }
    } catch (error) {
      addError({
        message: 'Failed to process real-time update',
        sessionId,
        recoverable: true,
      })
    }
  },
})
