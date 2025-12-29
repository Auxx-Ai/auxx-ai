// packages/lib/src/files/file-upload/types.ts
import type { EntityType } from '../types'
import type { File } from '@auxx/database/types'
// Re-export types for backward compatibility
export type {
  EntityType,
  FileInfo,
  UploadFile,
  ProcessingStage,
  DatasetFileMetadata,
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
/**
 * Entity-specific file processor interface
 */
export interface EntityFileProcessor {
  /**
   * Process file after upload for a specific entity type
   */
  processFile(
    fileRecord: File,
    entityId: string | undefined,
    metadata?: Record<string, any>
  ): Promise<void>
  /**
   * Get validation options for this entity type
   */
  getValidationOptions(): FileValidationOptions
  /**
   * Determine if file should be public or private for this entity
   */
  getDefaultVisibility(): FileVisibility
}
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
