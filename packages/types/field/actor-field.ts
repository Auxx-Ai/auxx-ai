// packages/types/field/actor-field.ts

import type { ActorTarget } from '@auxx/database/enums'

/**
 * Configuration options for ACTOR field type.
 * Stored in CustomField.options JSON column.
 */
export interface ActorFieldOptions {
  /** Target type for this actor field - determines what kind of entity can be assigned */
  target: ActorTarget
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
