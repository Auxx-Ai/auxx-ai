// packages/lib/src/files/shared-types/sessions.ts

/**
 * Shared session types for file upload session management
 * Safe for import by both frontend and backend - contains no server dependencies
 */

import type { EntityType } from './entities'

/**
 * Session status types
 */
export type SessionStatus =
  | 'created' // Session created but no uploads started
  | 'active' // Upload/processing in progress
  | 'completed' // All files processed successfully
  | 'failed' // Session failed with errors
  | 'expired' // Session expired without completion
  | 'cancelled' // Session cancelled by user

/**
 * File information for session tracking
 */
export interface FileInfo {
  id?: string
  name: string
  size: number
  type: string
  status?: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed'
  progress?: number
  error?: string
  url?: string
  checksum?: string
}

/**
 * Session configuration for creating new upload sessions
 */
export interface SessionConfig {
  id: string
  entityType: EntityType
  entityId?: string
  organizationId: string
  userId: string
}

/**
 * Session metadata stored in Redis/database
 */
export interface SessionData {
  id: string
  entityType: EntityType
  entityId?: string
  organizationId: string
  userId: string
  status: SessionStatus
  files: FileInfo[]
  metadata: Record<string, any>
  createdAt: string
  updatedAt: string
  expiresAt: string
  startedAt?: string
  completedAt?: string
  failedAt?: string
}

/**
 * Options for creating upload sessions
 */
export interface CreateSessionOptions {
  entityType: EntityType
  entityId?: string
  organizationId: string
  userId: string
  files: FileInfo[]
  metadata?: Record<string, any>
  expirationHours?: number // Default 24 hours
}

/**
 * Session update data
 */
export interface SessionUpdate {
  status?: SessionStatus
  files?: FileInfo[]
  metadata?: Record<string, any>
  startedAt?: Date
  completedAt?: Date
  failedAt?: Date
}

/**
 * Session query options
 */
export interface SessionQueryOptions {
  userId?: string
  organizationId?: string
  entityType?: EntityType
  entityId?: string
  status?: SessionStatus | SessionStatus[]
  createdAfter?: Date
  createdBefore?: Date
  limit?: number
  offset?: number
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalSessions: number
  activeSessions: number
  completedSessions: number
  failedSessions: number
  expiredSessions: number
  totalFiles: number
  totalSize: number
  averageSessionDuration?: number
  successRate: number
}

/**
 * Session cleanup result
 */
export interface SessionCleanupResult {
  removedSessions: number
  removedFiles: number
  freedSpace: number
  errors: string[]
}

/**
 * Session progress information
 */
export interface SessionProgress {
  sessionId: string
  overallProgress: number
  currentStage?: string
  stageProgress?: number
  filesCompleted: number
  totalFiles: number
  bytesProcessed?: number
  totalBytes?: number
  currentOperations?: string[]
  estimatedTimeRemaining?: number
  startedAt?: Date
  lastUpdated: Date
  errors?: string[]
}

/**
 * Session info for client consumption
 */
export interface SessionInfo {
  id: string
  entityType: EntityType
  entityId?: string
  status: SessionStatus
  createdAt: Date
  expiresAt: Date
  fileCount: number
  totalSize: number
  progress?: SessionProgress
}

/**
 * Upload session options for client
 */
export interface UploadSessionOptions {
  entityType: EntityType
  entityId?: string
  metadata?: Record<string, any>
}
