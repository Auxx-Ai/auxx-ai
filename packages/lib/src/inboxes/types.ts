// packages/lib/src/inboxes/types.ts

import type { RecordId } from '@auxx/types/resource'
import type { Lens } from '../permissions/visibility/lens'

/**
 * Inbox visibility options.
 * @deprecated Superseded by `defaultLens` (mail-permissions §2.2). Kept until
 * Phase 6 removes the legacy field; new code reads/writes `defaultLens`.
 */
export type InboxVisibility = 'org_members' | 'private' | 'custom'

/** Inbox status options */
export type InboxStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

/** Input for creating an inbox */
export interface CreateInboxInput {
  name: string
  description?: string
  color?: string
  status?: InboxStatus
  visibility?: InboxVisibility
  /** Org-wide visibility floor (defaults to `full` — everyone sees everything). */
  defaultLens?: Lens
  settings?: Record<string, unknown>
}

/** Input for updating an inbox */
export interface UpdateInboxInput {
  name?: string
  description?: string
  color?: string
  status?: InboxStatus
  visibility?: InboxVisibility
  defaultLens?: Lens
  settings?: Record<string, unknown>
}

/** Inbox with resolved field values */
export interface Inbox {
  /** Raw instance ID (for DB operations only) */
  id: string
  /** Branded RecordId - use this for all service method calls */
  recordId: RecordId
  name: string
  description: string | null
  color: string
  status: InboxStatus
  visibility: InboxVisibility
  /**
   * Org-wide visibility floor: the lens every org member gets on this inbox
   * (mail-permissions §2.2). Explicit grants can only raise it.
   */
  defaultLens: Lens
  settings: Record<string, unknown>
  organizationId: string
  createdAt: Date
  updatedAt: Date
  createdById: string | null
}

/** Single inbox integration */
export interface InboxIntegration {
  id: string
  integrationId: string
  isDefault: boolean
  settings: Record<string, unknown>
  integration: {
    id: string
    name: string
    email: string | null
    provider: string
  }
}

/** Inbox with integrations */
export interface InboxWithIntegrations extends Inbox {
  integrations: InboxIntegration[]
}
