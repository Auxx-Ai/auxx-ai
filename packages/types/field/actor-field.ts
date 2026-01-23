// packages/types/field/actor-field.ts

import type { ActorTarget } from '@auxx/database/enums'

/**
 * Configuration options for ACTOR field type.
 * Stored in CustomField.options.actor JSON field.
 */
export interface ActorFieldOptions {
  /** Target type - determines who can be assigned ('user', 'group', or 'both') */
  target: ActorTarget

  /** Allow selecting multiple actors */
  multiple: boolean

  /** Limit to specific org roles (optional, only when target includes 'user') */
  roles?: ('OWNER' | 'ADMIN' | 'USER')[]

  /** Limit to specific groups (optional, only when target includes 'group') */
  groupIds?: string[]
}

/**
 * Value structure for ACTOR fields when target is 'user'.
 * References a User entity via actorId.
 */
export interface ActorUserValue {
  actorType: 'user'
  /** User ID */
  id: string
  /** Denormalized display name for UI rendering */
  displayName?: string
  /** Denormalized avatar URL for UI rendering */
  avatarUrl?: string
}

/**
 * Value structure for ACTOR fields when target is 'group'.
 * References an EntityGroup via relatedEntityId/relatedEntityDefinitionId.
 */
export interface ActorGroupValue {
  actorType: 'group'
  /** Entity group instance ID */
  id: string
  /** Entity group definition ID */
  entityDefinitionId: string
  /** Denormalized display name for UI rendering */
  displayName?: string
}

/**
 * Union type for ACTOR field values.
 */
export type ActorFieldValue = ActorUserValue | ActorGroupValue
