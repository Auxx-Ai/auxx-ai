// packages/types/actor/index.ts

// ============================================================================
// ActorId - Branded String Type
// ============================================================================

/**
 * Branded ActorId type: "user:abc123" or "group:xyz789"
 * Unifies user and group references into a single string format.
 */
export type ActorId = string & { readonly __brand: 'ActorId' }

/** Actor type discriminator */
export type ActorType = 'user' | 'group'

/**
 * Parse ActorId into its components.
 * @throws Error if ActorId is malformed
 */
export function parseActorId(actorId: ActorId): { type: ActorType; id: string } {
  if (!actorId) {
    throw new Error(`Invalid ActorId: ${actorId}`)
  }

  const colonIndex = actorId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(`Invalid ActorId (missing colon): ${actorId}`)
  }

  const type = actorId.slice(0, colonIndex) as ActorType
  const id = actorId.slice(colonIndex + 1)

  if (!type || !id || !['user', 'group'].includes(type)) {
    throw new Error(`Invalid ActorId: ${actorId}`)
  }

  return { type, id }
}

/**
 * Create ActorId from components.
 */
export function toActorId(type: ActorType, id: string): ActorId {
  return `${type}:${id}` as ActorId
}

/**
 * Type guard to check if a string is a valid ActorId format.
 */
export function isActorId(value: unknown): value is ActorId {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  return parts.length === 2 && ['user', 'group'].includes(parts[0]!)
}

/**
 * Get the raw ID from an ActorId.
 */
export function getActorRawId(actorId: ActorId): string {
  return parseActorId(actorId).id
}

/**
 * Get the type from an ActorId.
 */
export function getActorType(actorId: ActorId): ActorType {
  return parseActorId(actorId).type
}

// ============================================================================
// Actor - Resolved Display Data
// ============================================================================

/** Base actor info for display */
interface BaseActor {
  /** Unique ActorId (e.g., "user:abc123" or "group:xyz789") */
  actorId: ActorId
  /** Actor type discriminator */
  type: ActorType
  /** Display name */
  name: string
  /** Avatar URL if available */
  avatarUrl: string | null
}

/** User actor with additional user-specific fields */
export interface UserActor extends BaseActor {
  type: 'user'
  /** User's email address */
  email: string
  /** Organization role */
  role: 'OWNER' | 'ADMIN' | 'USER'
}

/** Group actor with additional group-specific fields */
export interface GroupActor extends BaseActor {
  type: 'group'
  /** Group description */
  description: string | null
  /** Number of members in the group */
  memberCount: number
  /** Group visibility setting */
  visibility: 'public' | 'private'
}

/** Union type for any actor */
export type Actor = UserActor | GroupActor

// ============================================================================
// Actor Context (for services)
// ============================================================================

/** Context passed to actor service operations (server-side only) */
export interface ActorContext {
  /** Database instance - use `import type { Database } from '@auxx/database'` for full type */
  db: unknown
  organizationId: string
  userId: string
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an actor is a user actor.
 */
export function isUserActor(actor: Actor): actor is UserActor {
  return actor.type === 'user'
}

/**
 * Check if an actor is a group actor.
 */
export function isGroupActor(actor: Actor): actor is GroupActor {
  return actor.type === 'group'
}
