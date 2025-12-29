// packages/lib/src/files/session/index.ts

/**
 * File upload session management module
 * Exports session classes, types, and utilities
 */

// Session class
export { FileUploadSession } from './upload-session-service'

// Session manager
export { SessionManager } from './session-manager'

// Shared types (exported from shared-types via session-types)
export type {
  EntityType,
  FileInfo,
  UploadFile,
  SessionStatus,
  SessionInfo,
  SessionData,
  CreateSessionOptions,
  SessionProgress,
  SessionConfig,
} from '../types'
