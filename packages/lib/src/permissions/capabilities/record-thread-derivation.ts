// packages/lib/src/permissions/capabilities/record-thread-derivation.ts

import type { Rung } from '@auxx/database/enums'
import { RUNG_ORDER } from './rung'

/**
 * **The cascade cap** (plan v3/03 §10.2 / §13.1, RESOLVED 2026-07-29).
 *
 * ## The behaviour this replaces
 *
 * Today ANY record grant already lands in mail's primary-entity lane and raises
 * the lens on every thread whose `primaryEntityInstanceId` is that record
 * (`visibility/derivation-rules.ts`, rule `entity-grant`). That is an *accident*
 * of the keyspace, not a decision: it fires for every def whose CUID can be a
 * thread's primary entity, at whatever rung the grant carries, all-or-nothing.
 * P5 widens who may write record grants, so an accidental fan-out becomes a
 * real leak — "I shared the deal record" must not silently mean "and its whole
 * email history".
 *
 * ## The replacement: a DECLARED per-def derivation with a rung cap
 *
 * - **Ticket-like defs derive thread `read`.** A ticket share without its
 *   conversation is an empty shell — the conversation *is* the ticket.
 * - **Generic record defs derive NOTHING.** A deal, a company, a work order:
 *   sharing the row shares the row.
 *
 * The cap is a CEILING, never a floor: the derived rung is
 * `min(grantRung, cap)`, so a `admin` grant on a ticket still derives only
 * `read`, and no def can derive more than the member's own grant.
 *
 * ## Keyed by `entityType`, not by def id
 *
 * Record definitions are per-org CUIDs, so a def-id-keyed table cannot be
 * code-authored. `EntityDefinition.entityType` is the stable system slug that
 * survives across orgs and is what {@link TICKET_LIKE_ENTITY_TYPES} names.
 * Custom defs carry `entityType: null` and therefore derive nothing, which is
 * the fail-closed direction and the intended default.
 *
 * ## Wiring — LIVE since P5
 *
 * Both halves of the primary-entity lane consume it, and they must stay in
 * lockstep or the list predicate and the lens evaluator disagree on the same
 * thread:
 *  - `primaryEntityThreadRung` (`visibility/context.ts`) — the per-thread
 *    evaluator behind the `entity-grant` derivation rule;
 *  - `primaryEntityThreadIdsAtOrAbove` (same file) — the id list behind
 *    `mail-query/visibility-scope.ts`'s SQL predicate.
 *
 * The `entityType` they key on rides `UserInstanceGrants.defEntityTypes`,
 * projected at compose time onto exactly the defs the member holds grants on.
 * That field is why the blob went to `user:instance-grants:v2`.
 */

/**
 * `EntityDefinition.entityType` values whose records ARE their conversation, and
 * therefore derive a thread rung.
 *
 * A set rather than a boolean flag on the def row: this is a code-authored
 * product judgement about a system def's nature, not org configuration. An org
 * cannot make its custom "Case" def ticket-like by editing a checkbox, because
 * the fan-out it would turn on is exactly the one §10.1's contact hazard warns
 * about.
 */
export const TICKET_LIKE_ENTITY_TYPES: ReadonlySet<string> = new Set(['ticket'])

/**
 * The highest thread rung a record grant on this def may derive.
 *
 * `'none'` — the default for every def not named above — means the grant
 * derives nothing onto threads at all.
 */
export function recordThreadDerivationCap(entityType: string | null | undefined): Rung {
  if (entityType && TICKET_LIKE_ENTITY_TYPES.has(entityType)) return 'read'
  return 'none'
}

/**
 * Apply the cap: the thread rung a record grant of `grantRung` on a def of
 * `entityType` derives.
 *
 * `min(grantRung, cap)` — a ceiling in both directions. An absent grant derives
 * `'none'`; a def with no declared cap derives `'none'` however strong the grant
 * is.
 */
export function deriveThreadRungFromRecordGrant(
  grantRung: Rung | undefined,
  entityType: string | null | undefined
): Rung {
  if (!grantRung) return 'none'
  const cap = recordThreadDerivationCap(entityType)
  return RUNG_ORDER[grantRung] <= RUNG_ORDER[cap] ? grantRung : cap
}
