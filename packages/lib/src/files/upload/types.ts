// packages/lib/src/files/upload/types.ts

import type { FileEntity as File } from '@auxx/database/types'
import type { EntityType } from '../types'

// Re-export types for backward compatibility
export type {
  DatasetFileMetadata,
  EntityType,
  FileInfo,
  ProcessingStage,
  UploadFile,
} from '../types'
/**
 * File visibility options
 */
export type FileVisibility = 'public' | 'private'
/**
 * File status tracking
 */
export type FileStatus = 'PENDING' | 'CONFIRMED' | 'ARCHIVED' | 'DELETED'
/**
 * Parameters for uploading a file
 */
export interface FileUploadParams {
  file: File | Buffer
  filename: string
  mimeType?: string
  entityType: EntityType
  entityId?: string
  metadata?: Record<string, any>
  visibility: FileVisibility
  userId: string
  organizationId: string
}
/**
 * Result of a file upload operation
 */
export interface FileUploadResult {
  id: string
  storageKey: string
  url: string
  size: number
  mimeType: string
  checksum?: string
  visibility: FileVisibility
  status: FileStatus
  expiresAt?: Date
}
/**
 * File validation options
 */
export interface FileValidationOptions {
  maxSize?: number
  allowedMimeTypes?: string[]
  allowedExtensions?: string[]
  scanForViruses?: boolean
}
// `EntityFileProcessor` lived here: a third per-entity vocabulary alongside the
// processor classes and `UPLOAD_HANDLERS`, with zero implementors and zero
// callers in the repo's history. Deleted with the processors in PR 4d.
/**
 * File validation error
 */
export class FileValidationError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
    this.name = 'FileValidationError'
  }
}
