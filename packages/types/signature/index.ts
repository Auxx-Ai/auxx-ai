// packages/types/signature/index.ts

import type { RecordId } from '../resource'

/**
 * Visibility options for signatures (aligned with inbox visibility)
 * Replaces the old SignatureSharingType enum entirely.
 */
export type SignatureVisibility = 'org_members' | 'private' | 'custom'

/**
 * Signature record type for UI components
 */
export interface SignatureRecord {
  id: string
  name: string
  body: string
  isDefault: boolean
  visibility: SignatureVisibility
  createdById: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Simplified signature type for hooks (with optional RecordId for entity system)
 */
export interface SignatureItem {
  id: string
  recordId?: RecordId
  name: string
  body: string
  isDefault: boolean
  visibility: SignatureVisibility
  createdById?: string
}
