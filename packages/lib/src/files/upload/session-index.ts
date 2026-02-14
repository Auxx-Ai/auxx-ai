// packages/lib/src/files/session/index.ts

/**
 * File upload session management module
 * Exports session classes, types, and utilities
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
// Session class
export { FileUploadSession } from './upload-session-service'
