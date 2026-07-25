// apps/web/src/components/permissions/utils/grantee.ts

import { ResourceGranteeType, type SharingGranteeType } from '@auxx/database/enums'
import { type ActorId, toActorId } from '@auxx/types/actor'
import { tryParseActorId } from '~/components/resources/utils/actor-id'

/** A `ResourceAccess` grantee address as the sharing surfaces write it. */
export interface ShareGrantee {
  granteeType: SharingGranteeType
  granteeId: string
}

/** A stored grant a sharing surface can neither render as an actor nor edit. */
export interface UnmanageableGrant {
  granteeType: string
  granteeId: string
}

/**
 * ActorId prefix → the `ResourceAccess` grantee type that stores it.
 *
 * Deliberately **partial**: only `user:` and `group:` have a storage kind whose
 * id half is the same id as the ActorId's. `agent:` carries the `Agent.id` while
 * an agent grant stores the agent's backing `User.id` (`def-access-section.tsx`
 * owns that translation), and `worker:` carries a `DispatchWorker.id` with no
 * grantee kind at all. The `type === 'group' ? group : user` ternaries this
 * replaces wrote, for either of those, a row whose id half pointed at the wrong
 * table — a corrupt ACL row no resolver can ever match and no admin can see.
 */
const GRANTEE_TYPE_BY_ACTOR_PREFIX: Record<string, SharingGranteeType> = {
  user: ResourceGranteeType.user,
  group: ResourceGranteeType.group,
}

/** The inverse: grantee type → the ActorId prefix that displays it. */
const ACTOR_PREFIX_BY_GRANTEE_TYPE: Record<string, 'user' | 'group'> = {
  [ResourceGranteeType.user]: 'user',
  [ResourceGranteeType.group]: 'group',
}

/** Human copy for a grantee kind a sharing surface cannot manage. */
const GRANTEE_KIND_LABEL: Record<string, string> = {
  [ResourceGranteeType.profile]: 'permission profile',
  [ResourceGranteeType.role]: 'workspace baseline',
  [ResourceGranteeType.team]: 'team',
  [ResourceGranteeType.group]: 'group',
  [ResourceGranteeType.user]: 'person',
}

/** Shown when a picked actor has no grantee representation. */
export const GRANTEE_UNSUPPORTED_MESSAGE =
  'Only people and groups can be given access here. Agents are granted from the record type’s Access tab.'

/**
 * Resolve an ActorId to the `ResourceAccess` grantee it must be stored as, or
 * `null` when the actor has no such representation. Callers MUST treat `null` as
 * "refuse the write" — never as "fall back to `user`".
 */
export function actorIdToGrantee(actorId: ActorId | string): ShareGrantee | null {
  const parsed = tryParseActorId(actorId)
  if (!parsed) return null
  const granteeType = GRANTEE_TYPE_BY_ACTOR_PREFIX[parsed.type]
  if (!granteeType) return null
  return { granteeType, granteeId: parsed.id }
}

/**
 * Resolve a stored grant row to the ActorId that displays it, or `null` when the
 * grantee kind is not an actor (`role` baselines, `profile` grants, `team`).
 * A `null` row belongs in {@link unmanageableGrantsNote}, not in the actor list.
 */
export function granteeToActorId(granteeType: string, granteeId: string): ActorId | null {
  const prefix = ACTOR_PREFIX_BY_GRANTEE_TYPE[granteeType]
  if (!prefix || !granteeId) return null
  return toActorId(prefix, granteeId)
}

/** Whether a stored grant row can be rendered as an actor row in a share list. */
export function isActorGrantee(granteeType: string): boolean {
  return granteeType in ACTOR_PREFIX_BY_GRANTEE_TYPE
}

/** `'permission profile'`, `'team'`, … — falls back to the raw kind, never blank. */
export function granteeKindLabel(granteeType: string): string {
  return GRANTEE_KIND_LABEL[granteeType] ?? `${granteeType} grantee`
}

/**
 * One muted sentence naming grants this surface cannot show or revoke, so an
 * admin is never told "not shared with anyone" while rows exist server-side.
 * Returns `null` when there is nothing to disclose.
 */
export function unmanageableGrantsNote(grants: UnmanageableGrant[]): string | null {
  if (grants.length === 0) return null
  const kinds = [...new Set(grants.map((g) => granteeKindLabel(g.granteeType)))].sort()
  const noun = grants.length === 1 ? 'grant' : 'grants'
  const verb = grants.length === 1 ? 'is' : 'are'
  return `${grants.length} ${kinds.join(' / ')} ${noun} ${verb} also in effect and can’t be changed here.`
}
