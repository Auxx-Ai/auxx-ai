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

// Three types lived here and are gone with the processors (PR 4d), all with
// zero references anywhere in the repo:
//
// - `UploadPreferences` — "preferences that processors can specify". Its twin in
//   `processors/types.ts` was equally unread, and `preferredProvider` was
//   abstract on every processor while the provider actually came from
//   `init.provider ?? 'S3'`.
// - `ProgressUpdate` — "for SSE". There is no SSE endpoint for uploads.
// - `ProcessingResult` — superseded by `handlers/types.ts`'s `PersistResult`,
//   which is the shape the persistence step really returns.
