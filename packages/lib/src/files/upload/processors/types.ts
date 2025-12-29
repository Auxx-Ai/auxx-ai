// packages/lib/src/files/upload/processors/types.ts

import type { PresignedUploadSession } from '../session-types'

export interface ProcessorMetadata {
  /** Human-readable processor name */
  name: string
  /** Entity types this processor can handle */
  entityTypes: string[]
  /** Whether this processor supports MediaAssets */
  supportsAssets: boolean
  /** Whether this processor supports FolderFiles */
  supportsFiles: boolean
  /** Whether this processor supports Attachments */
  supportsAttachments: boolean
}

export interface CreateSessionRequest {
  fileName: string
  mimeType: string
  expectedSize: number
  organizationId: string
  userId: string
  provider?: string
  metadata?: SessionMetadata
}

export interface SessionMetadata {
  /** File type selection */
  createAsset?: boolean // true = MediaAsset, false = FolderFile

  /** Entity linking (for attachments) */
  entityType?: string
  entityId?: string
  role?: string

  /** File organization */
  folderId?: string
  title?: string
  caption?: string

  /** Access control */
  isPublic?: boolean
  isTemporary?: boolean
  expiresAt?: Date

  /** Processing options */
  generateThumbnails?: boolean
  extractText?: boolean
  enableCompression?: boolean
}

/**
 * Dataset-specific metadata for document upload processor
 */
export interface DatasetAssetMetadata extends SessionMetadata {
  datasetId: string
  documentName?: string
  processingOptions?: {
    chunkSize?: number
    chunkOverlap?: number
    chunkingStrategy?: string
    embeddingModel?: string // "provider:model" format (e.g., "openai:text-embedding-3-small")
    skipParsing?: boolean
    skipEmbedding?: boolean
  }
}

// Use PresignedUploadSession from session-types instead of local UploadSession
export type UploadSession = PresignedUploadSession

export interface PreprocessResult {
  /** Whether the session request is valid */
  valid: boolean
  /** Validation errors if any */
  errors: string[]
  /** Validation warnings */
  warnings: string[]
  /** Enhanced metadata with auto-detected values */
  enhancedMetadata?: Partial<SessionMetadata>
  /** Upload preferences for this processor */
  uploadPreferences?: UploadPreferences
}

export interface UploadPreferences {
  /** Preferred storage provider */
  preferredProvider: string
  /** File visibility setting */
  visibility: 'public' | 'private'
  /** Maximum file size in bytes */
  maxFileSize?: number
  /** Allowed MIME types */
  allowedMimeTypes?: string[]
  /** Additional storage configuration */
  storageConfig?: Record<string, any>
}

export type ProcessorResult =
  | {
      /** FolderFile ID if created */
      fileId: string
      /** MediaAsset ID never present for file results */
      assetId?: never
      /** Attachment ID if created */
      attachmentId?: string
      /** StorageLocation ID (always present) */
      storageLocationId: string
      /** Document ID if created (for dataset uploads) */
      documentId?: string
    }
  | {
      /** MediaAsset ID if created */
      assetId: string
      /** FolderFile ID never present for asset results */
      fileId?: never
      /** Attachment ID if created */
      attachmentId?: string
      /** StorageLocation ID (always present) */
      storageLocationId: string
      /** Document ID if created (for dataset uploads) */
      documentId?: string
    }

export interface FileProcessor {
  /** Get processor metadata */
  getMetadata(): ProcessorMetadata

  /** Process uploaded file and create records */
  process(
    session: PresignedUploadSession, 
    storageLocationId: string,
    opts?: { tx?: any }
  ): Promise<ProcessorResult>
}
