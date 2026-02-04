// packages/lib/src/inboxes/types.ts

import type { RecordId } from '@auxx/types/resource'

/** Inbox visibility options */
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
  settings?: Record<string, unknown>
}

/** Input for updating an inbox */
export interface UpdateInboxInput {
  name?: string
  description?: string
  color?: string
  status?: InboxStatus
  visibility?: InboxVisibility
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

/** Inbox access update input */
export interface InboxAccessInput {
  visibility?: InboxVisibility
  memberIds?: string[]
  groupIds?: string[]
}
