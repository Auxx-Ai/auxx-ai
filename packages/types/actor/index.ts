// packages/types/actor/index.ts

// ============================================================================
// ActorId - Branded String Type
// ============================================================================

/**
 * Branded ActorId type: "user:abc123" or "group:xyz789"
 * Unifies user and group references into a single string format.
 */
export type ActorId = string & { readonly __brand: 'ActorId' }

/**
 * Type discriminator for ActorId prefix.
 *
 * - `user:` — real users + system users (system users are stored in the User table).
 * - `group:` — actor groups.
 * - `agent:` — Kopilot agents. The id half is the `Agent.id`, not the underlying
 *   `User.id` (agents are backed by a synthetic User row, but the actor system
 *   addresses them by their Agent row directly).
 * - `worker:` — dispatch workers. The id half is the `DispatchWorker.id`. An individual
 *   worker resolves to its user's identity (+ board color); a team resolves to its name +
 *   member avatar stack (plans/dispatch/45-teams.md §1.H).
 */
export type ActorIdType = 'user' | 'group' | 'agent' | 'worker'

/**
 * Type discriminator for resolved Actor objects.
 * Widened with `'system'`, `'agent'`, and `'worker'` so callers can distinguish automated/system
 * actors, Kopilot agents, dispatch workers, and real users. The ActorId format stays `user:<id>`
 * for system users — only the resolved `.type` field differs.
 */
export type ActorType = 'user' | 'group' | 'system' | 'agent' | 'worker'

/**
 * Parse ActorId into its components.
 * @throws Error if ActorId is malformed
 */
export function parseActorId(actorId: ActorId): { type: ActorIdType; id: string } {
  if (!actorId) {
    throw new Error(`Invalid ActorId: ${actorId}`)
  }

  const colonIndex = actorId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(`Invalid ActorId (missing colon): ${actorId}`)
  }

  const type = actorId.slice(0, colonIndex) as ActorIdType
  const id = actorId.slice(colonIndex + 1)

  if (!type || !id || !['user', 'group', 'agent', 'worker'].includes(type)) {
    throw new Error(`Invalid ActorId: ${actorId}`)
  }

  return { type, id }
}

/**
 * Create ActorId from components.
 */
export function toActorId(type: ActorIdType, id: string): ActorId {
  return `${type}:${id}` as ActorId
}

/**
 * Type guard to check if a string is a valid ActorId format.
 */
export function isActorId(value: unknown): value is ActorId {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  return parts.length === 2 && ['user', 'group', 'agent', 'worker'].includes(parts[0]!)
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
export function getActorType(actorId: ActorId): ActorIdType {
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

/**
 * System actor — represents an organization's automated/AI user.
 * ActorId still uses the `user:<id>` prefix for storage compatibility.
 */
export interface SystemActor extends BaseActor {
  type: 'system'
}

/**
 * Agent actor — Auxx-AI configurable agent surfaced as a workspace user.
 * Backed by a synthetic User row with userType = 'AGENT'. The ActorId
 * uses the `agent:<agentId>` prefix — `agentId` is the `Agent.id`, not
 * the underlying `User.id`. Callers that need the synthetic user row id
 * for storage (e.g. `Thread.assigneeIds`) should look it up via the
 * actor service.
 */
export interface AgentActor extends BaseActor {
  type: 'agent'
  /** The Agent row id. Mirrors the id half of `actorId` (`agent:<agentId>`). */
  agentId: string
  /** The underlying User row id (for legacy assignee storage / session attribution). */
  userId: string
  /** Agent slug for routing. */
  slug: string
  /** Whether this agent is @-mentionable / assignable. */
  mentionable: boolean
}

/**
 * Worker actor — a dispatch board resource (`DispatchWorker`), individual or team.
 * The ActorId uses the `worker:<workerId>` prefix — `workerId` is the `DispatchWorker.id`,
 * NOT the underlying `User.id`. An individual resolves to its user's name/avatar (+ board
 * color); a team resolves to its own name + a stack of member avatars (like `GroupActor`).
 * See plans/dispatch/45-teams.md §5A.
 */
export interface WorkerActor extends BaseActor {
  type: 'worker'
  /** The DispatchWorker row id. Mirrors the id half of `actorId` (`worker:<workerId>`). */
  workerId: string
  /** 'individual' | 'team'. */
  workerType: 'individual' | 'team'
  /** Board column/chip accent color. */
  color: string | null
  /** For individuals: the backing User row id (null for teams). */
  userId: string | null
  /** For teams: the member individuals (empty for individuals). Powers the avatar stack. */
  members: { id: string; name: string; image: string | null }[]
}

/** Union type for any actor */
export type Actor = UserActor | GroupActor | SystemActor | AgentActor | WorkerActor

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

/**
 * Check if an actor is a system actor.
 */
export function isSystemActor(actor: Actor): actor is SystemActor {
  return actor.type === 'system'
}

/**
 * Check if an actor is an agent actor.
 */
export function isAgentActor(actor: Actor): actor is AgentActor {
  return actor.type === 'agent'
}

/**
 * Check if an actor is a worker actor (dispatch individual or team).
 */
export function isWorkerActor(actor: Actor): actor is WorkerActor {
  return actor.type === 'worker'
}
