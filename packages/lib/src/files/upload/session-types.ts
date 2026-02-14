// packages/lib/src/files/upload/session-types.ts

import type { ProviderId } from '../adapters/base-adapter'
import type { EntityType } from '../types/entities'
import type { UploadPlan, UploadPolicy } from './init-types'

/**
 * Enhanced session types for presigned upload implementation
 */

/**
 * Complete session data structure for presigned uploads
 */
export interface PresignedUploadSession {
  version: 2
  id: string
  organizationId: string
  userId: string
  entityType: EntityType // ✅ canonical only
  entityId?: string
  fileName: string
  mimeType: string
  expectedSize: number
  provider: ProviderId
  storageKey: string
  credentialId?: string
  isMultipart: boolean
  uploadMethod: 'PUT' | 'POST'
  uploadId?: string
  presignedUrl?: string
  presignedFields?: Record<string, string>
  status: 'created' | 'uploading' | 'processing' | 'completed' | 'failed'
  createdAt: Date
  expiresAt: Date
  ttlSec: number
  metadata: Record<string, any> // ✅ unified metadata
  policy: UploadPolicy // persisted snapshot
  uploadPlan: UploadPlan
  /** Resolved S3 bucket for the session's storage operations */
  bucket: string
  /** Visibility flag that determines which bucket was selected */
  visibility: 'PUBLIC' | 'PRIVATE'
  storageLocationId?: string
  // ❌ Remove: processorType, processingMetadata
}

/**
 * Upload completion data provided by client after successful upload
 */
export interface UploadCompletionData {
  storageKey: string
  size: number
  mimeType: string
  etag?: string
  uploadId?: string // For multipart
  parts?: Array<{ partNumber: number; etag: string }> // For multipart
}

/**
 * Upload preferences that processors can specify
 */
export interface UploadPreferences {
  preferredProvider: string
  visibility: 'public' | 'private'
  maxFileSize?: number
  allowedMimeTypes?: string[]
  storageConfig?: Record<string, any>
}

/**
 * Progress update structure for SSE
 */
export interface ProgressUpdate {
  sessionId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed'
  progress?: number // 0-100 for upload progress
  message?: string
  timestamp: string
  details?: Record<string, any>
}

/**
 * Result of processing uploaded file
 */
export interface ProcessingResult {
  fileId?: string
  assetId?: string
  attachmentId?: string
  success: boolean
  error?: string
}
