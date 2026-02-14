// packages/lib/src/files/upload/init-types.ts

/**
 * Foundation types for the unified processor system
 * These types establish the single source of truth for upload configuration
 */

import type { ProviderId } from '../adapters/base-adapter'
import type { EntityType } from '../types/entities'

/**
 * Upload strategy configuration
 */
export type UploadPlan = {
  strategy: 'single' | 'multipart'
  partSize?: number
}

/**
 * Upload security policy configuration
 * Enforced centrally in StorageManager to prevent security gaps
 */
export type UploadPolicy = {
  keyPrefix: string
  contentLengthRange: [number, number]
  maxTtl: number
  allowedMimeTypes: string[]
}

/**
 * Initial upload configuration from user request
 * This is transformed by processors into UploadPreparedConfig
 */
export type UploadInitConfig = {
  organizationId: string
  userId: string
  fileName: string
  mimeType: string
  expectedSize: number
  entityType: EntityType // Direct EntityType usage - no processorType needed
  entityId?: string
  provider?: ProviderId
  credentialId?: string
  metadata?: Record<string, any>
  keySeed?: string
  ttlSec?: number
}

/**
 * Finalized upload configuration produced by processors
 * This is the single source of truth for the entire upload process
 * All fields are required and validated - immutable throughout the flow
 */
export type UploadPreparedConfig = UploadInitConfig & {
  provider: ProviderId
  storageKey: string
  ttlSec: number
  credentialId?: string
  policy: UploadPolicy
  uploadPlan: UploadPlan
  visibility: 'PUBLIC' | 'PRIVATE' // File visibility determines bucket routing
  bucket: string // Which bucket to use (public or private)
}

/**
 * Result of processor configuration with warnings
 */
export interface ProcessorConfigResult {
  config: UploadPreparedConfig
  warnings: string[]
}
