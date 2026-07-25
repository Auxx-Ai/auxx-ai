// apps/web/src/components/resources/utils/actor-id.ts

import { type ActorId, type ActorType, isActorIdType } from '@auxx/types/actor'

/** A split ActorId whose prefix has NOT been validated against the whitelist. */
export interface LooseActorId {
  /** The raw prefix. May be a kind the actor system cannot resolve. */
  type: string
  /** The id half — everything after the first colon. */
  id: string
}

/**
 * Split `<prefix>:<id>` without validating the prefix. Returns `null` for an
 * empty, colon-less, or empty-half value. Never throws, whatever `parseActorId`
 * does with an unknown prefix.
 */
export function tryParseActorId(value: string | null | undefined): LooseActorId | null {
  if (!value) return null
  const colon = value.indexOf(':')
  if (colon <= 0) return null
  const id = value.slice(colon + 1)
  if (!id) return null
  return { type: value.slice(0, colon), id }
}

/**
 * The prefix narrowed to a known actor kind, or `undefined` when the value is
 * malformed or names a kind outside `ACTOR_ID_TYPES`.
 *
 * The vocabulary comes from `@auxx/types/actor` rather than a local copy:
 * duplicating that list in three places is precisely what made an unlisted
 * prefix white-screen render paths (19a finding 5). Only the *throwing* half of
 * that module is avoided here — `isActorIdType` is a total predicate, so a
 * non-actor value like the `placeholder:currentUser` filter sentinel still
 * degrades to `undefined` instead of throwing.
 */
export function tryActorIdType(value: string | null | undefined): ActorType | undefined {
  const parsed = tryParseActorId(value)
  if (!parsed) return undefined
  return isActorIdType(parsed.type) ? parsed.type : undefined
}

/**
 * The glyph type for an actor row: the resolved actor's own type when hydration
 * has landed, else the id prefix, else the neutral person glyph.
 *
 * This is the safe replacement for `actor?.type ?? parseActorId(id).type`, which
 * throws — during load, when the actor has not resolved yet — for any id whose
 * prefix is outside the whitelist.
 */
export function actorAvatarType(
  actorId: ActorId | string | undefined,
  resolved?: ActorType
): ActorType {
  return resolved ?? tryActorIdType(actorId) ?? 'user'
}
