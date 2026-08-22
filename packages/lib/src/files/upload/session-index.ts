// packages/lib/src/files/upload/session-index.ts

/**
 * File upload session management module
 * Exports session types and the Redis-backed session manager.
 */

// Shared types (exported from shared-types via session-types)
export type {
  CreateSessionOptions,
  EntityType,
  FileInfo,
  SessionConfig,
  SessionData,
  SessionInfo,
  SessionProgress,
  SessionStatus,
  UploadFile,
} from '../types'

// Session manager
export { SessionManager } from './session-manager'
