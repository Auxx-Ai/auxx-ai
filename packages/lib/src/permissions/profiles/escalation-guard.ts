// packages/lib/src/permissions/profiles/escalation-guard.ts

import type { ResourcePermission, Rung } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { ForbiddenError } from '../../errors'
import { PERMISSION_RANK } from '../capabilities/compose-user-capabilities'
import { AREA_ORDER, type Area, Level, PERMISSION_AREAS } from '../capabilities/registry'
import { RUNG_ORDER } from '../capabilities/rung'
import type { EffectiveState } from './effective-state'
import type { ProfileCeiling } from './types'

/**
 * Above this many affected holders the guard stops composing per-holder states
 * and falls back to {@link assertProfileMapNoEscalation} (§6.1.3).
 *
 * A **security** budget, unrelated to `profile-invalidation.ts`'s
 * `BROADCAST_THRESHOLD` (a cache-delivery budget of 50). Crossing this one
 * changes what is *allowed* — deliberately in the conservative direction
 * (§11.6), so a very large org may see a legitimate edit refused.
 */
export const HOLDER_GUARD_CAP = 500

/** Display names for the level ladder, for the denial message. */
const LEVEL_NAMES: Record<Level, string> = {
  [Level.None]: 'None',
  [Level.Read]: 'Read',
  [Level.Edit]: 'Edit',
  [Level.Full]: 'Full',
}

/** `undefined` (no access) ranks below every real permission. */
function rank(permission: ResourcePermission | undefined): number {
  return permission === undefined ? 0 : PERMISSION_RANK[permission]
}

/** {@link rank}'s twin for the INSTANCE lane, which is {@link Rung}-valued. */
function rungRank(rung: Rung | undefined): number {
  return rung === undefined ? 0 : RUNG_ORDER[rung]
}

/**
 * The actor's own authority (§6.1.1): their effective state, composed by the
 * SAME composer every holder goes through, plus the role that decides the
 * recovery short-circuit.
 */
export interface ActorAuthority {
  userId: string
  role: OrganizationRole
  state: EffectiveState
}

function deny(message: string): never {
  throw new ForbiddenError(
    `You cannot grant access you do not hold yourself. ${message} ` +
      'Ask an owner, or an admin with that access, to make this change.'
  )
}

/**
 * The §0.23 escalation guard — *you may only write or assign access you already
 * hold* — evaluated over each affected holder's **resulting effective state**,
 * never over the profile's own maps (§6.1).
 *
 * The comparison is **delta-gated, not absolute** (§6.1.2):
 *
 * ```
 * for each area a:      if after[a] > before[a] && after[a] > actorAreas[a]      → DENY
 * for each def d:       if rank(after) > rank(before) && rank(after) > actorDef  → DENY
 * for each instance i:  likewise
 * ```
 *
 * Two properties fall out, and both are load-bearing:
 *
 *  - **A decrease is always permitted.** Nothing is denied unless `after >
 *    before`, so an admin whose own access was narrowed can still clean up a
 *    profile — matching `clearGranteeLevels` not being plan-gated (removal only
 *    tightens).
 *  - **Pre-existing grants the actor never authored are still caught.** An edit
 *    that lifts a holder's base far enough for an existing group grant to become
 *    their effective level makes `after > before` true for that holder, so the
 *    actor must hold that level themselves even though the group grant is not
 *    part of the edit. This is the unsoundness (§6.1's mode 1) that comparing
 *    profile maps to the actor would miss.
 *
 * **OWNER short-circuits to pass as an early return** — not as a special case
 * threaded through the algorithm. That is what keeps §0.10's recovery guarantee:
 * a mis-shaped profile is always fixable by an owner.
 */
export function assertNoEscalation(input: {
  actor: ActorAuthority
  before: Map<string, EffectiveState>
  after: Map<string, EffectiveState>
}): void {
  const { actor, before, after } = input

  // §0.10 recovery guarantee. An owner is all-Full by construction, so every
  // comparison below would be vacuous anyway — but stating it as an early return
  // means no later change to the algorithm can accidentally lock the org out.
  if (actor.role === 'OWNER') return

  for (const [userId, afterState] of after) {
    const beforeState = before.get(userId)

    for (const area of AREA_ORDER) {
      const next = afterState.areas[area]
      const prev = beforeState?.areas[area] ?? Level.None
      if (next > prev && next > actor.state.areas[area]) {
        deny(
          `This change raises '${PERMISSION_AREAS[area].label}' from ${LEVEL_NAMES[prev]} to ` +
            `${LEVEL_NAMES[next]} for at least one member, above your own ${LEVEL_NAMES[actor.state.areas[area]]}.`
        )
      }
    }

    // Union of both sides: a def present in only one state still has a delta.
    for (const defId of new Set([
      ...Object.keys(afterState.defs),
      ...Object.keys(beforeState?.defs ?? {}),
    ])) {
      const next = afterState.defs[defId]
      const prev = beforeState?.defs[defId]
      if (rank(next) > rank(prev) && rank(next) > rank(actor.state.defs[defId])) {
        deny(
          `This change raises access to one entity definition for at least one member ` +
            `above your own access to it.`
        )
      }
    }

    for (const instanceId of new Set([
      ...Object.keys(afterState.instances),
      ...Object.keys(beforeState?.instances ?? {}),
    ])) {
      const next = afterState.instances[instanceId]
      const prev = beforeState?.instances[instanceId]
      // The INSTANCE lane is `Rung`-valued (plan v3/03 §3), so it ranks on
      // `RUNG_ORDER`; the def lane above stays `ResourcePermission`/
      // `PERMISSION_RANK`. Two ladders, two rank functions — comparing a rung
      // against `PERMISSION_RANK` would read `undefined`, i.e. rank 0, and every
      // instance escalation would pass the guard silently.
      if (
        rungRank(next) > rungRank(prev) &&
        rungRank(next) > rungRank(actor.state.instances[instanceId])
      ) {
        deny(
          `This change raises access to one shared resource for at least one member ` +
            `above your own access to it.`
        )
      }
    }
  }
}

/** The authored half of a profile — what the strict fallback compares. */
export interface ProfileAuthoredState {
  /** The profile's `PermissionGrant` levels (sparse; absent = unset). */
  levels: Partial<Record<Area, Level>>
  /** The profile's blanket fallback rung for unset areas. */
  baseLevel: Level | null
  /**
   * The profile's unauthored area clamp (plan 20 §2.a.3). Carried so the shape
   * matches what composition reads; nothing writes it, so it is `null` in
   * practice and never a source of a raise here.
   */
  ceiling: ProfileCeiling | null
}

/**
 * The >{@link HOLDER_GUARD_CAP}-holder fallback (§6.1.3): compare the **profile
 * map itself** against the actor's authority and require the actor to hold every
 * raised value outright.
 *
 * Still delta-gated on the profile map (so a decrease is permitted and an
 * untouched area is never re-litigated), but deliberately more conservative than
 * the exact check, because no holder state is available: an area moving from
 * *unset* to an explicit rung is treated as a raise from `None`, even where the
 * role default already supplied that rung.
 *
 * §11.6 records this as a known, accepted source of false refusals in very large
 * orgs.
 */
export function assertProfileMapNoEscalation(input: {
  actor: ActorAuthority
  before: ProfileAuthoredState
  after: ProfileAuthoredState
}): void {
  const { actor, before, after } = input
  if (actor.role === 'OWNER') return

  for (const area of AREA_ORDER) {
    // Unset falls through to a role default this check cannot see, so it is read
    // as `None` on BOTH sides: unset→unset is a no-op, unset→explicit is a raise.
    const next = after.levels[area] ?? after.baseLevel ?? Level.None
    const prev = before.levels[area] ?? before.baseLevel ?? Level.None
    if (next > prev && next > actor.state.areas[area]) {
      deny(
        `This profile sets '${PERMISSION_AREAS[area].label}' to ${LEVEL_NAMES[next]}, ` +
          `above your own ${LEVEL_NAMES[actor.state.areas[area]]}.`
      )
    }
  }
}
