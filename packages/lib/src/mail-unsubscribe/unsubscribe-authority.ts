// packages/lib/src/mail-unsubscribe/unsubscribe-authority.ts
// The §7.1 gate — WHO may unsubscribe an inbox.
//
// ⚠️ Read the boundary before editing. `packages/lib` holds no permission
// checks: nothing else in this module calls anything in this file, and none of
// the queries, mutations, the executor or the sweep job consult it. It lives
// here only because it is a PURE PREDICATE with no session, no cache and no
// I/O, and putting it beside the operation it describes is what keeps the rule
// and the code that implements it from drifting. **The ROUTER calls it, before
// calling `executeUnsubscribe`.** If it ever needs a DB read or a cache read,
// it belongs in `apps/web/src/server/lib/`, next to
// `mail-filter-authoring-access.ts`.

import { ForbiddenError } from '../errors'

/**
 * The one capability read this gate makes, structurally.
 *
 * Structural rather than `CapabilitySet` so a test can state the premise ("owns
 * the inbox, holds nothing") without composing a real capability blob — and so
 * this module never imports the permissions barrel, which hangs under vitest
 * (the `snippet-instance-access.ts` precedent).
 *
 * Declared as a METHOD, so a real `CapabilitySet` whose signature takes the wide
 * `InstanceAccessKey` union stays assignable.
 *
 * `canViewInstance` is the **`read` threshold**, which is the rung this gate
 * wants — see {@link canUnsubscribeOnInbox}. Naming the threshold rather than
 * the rung is deliberate: if the mail ladder ever gains a tier between
 * `identity` and `read`, the gate moves with it instead of quietly staying put.
 */
export interface UnsubscribeAuthorityCapabilities {
  canViewInstance(key: 'inbox', instanceId: string): boolean
}

/**
 * The inbox slice this gate reads. `@auxx/lib/inboxes`' `Inbox` satisfies it
 * structurally, so the router can pass a cached inbox straight in.
 */
export interface UnsubscribeInbox {
  id: string
  /** Which of the two inbox definitions the instance lives on. */
  entityDefinitionKey: 'inbox' | 'personal_inbox'
  /** Legacy `inbox_is_personal` marker — narrows only, never widens (see below). */
  isPersonal: boolean
  ownerUserId: string | null
}

/**
 * May this member unsubscribe this inbox from a list?
 *
 * ```
 *   personal_inbox owned by the caller  →  allowed. NO permission key.
 *   shared inbox (`inbox` def)          →  inbox READ, and NOTHING else.
 * ```
 *
 * **This deliberately diverges from the filter-authoring gate**, which requires
 * `automationRules.manage` AND inbox `admin`. Unsubscribing is a mail operation,
 * not an automation one; requiring an automation grant to stop a newsletter
 * would gate mail on admin rank, which the mail guide forbids (filters-plan
 * invariant 7). Per-inbox authority is the whole model here.
 *
 * The personal branch keys on the inbox's DEFINITION — def membership is the
 * unforgeable half of the mail model. The legacy `isPersonal` marker is honored
 * only to REMOVE the shared branch, never to grant the personal one, matching
 * `canAuthorOnInbox` in `mail-filter-authoring-access.ts`: personal-ness can be
 * self-declared into a stricter rule, never forged into a laxer one.
 *
 * ⚠️ **Why `read`, and why it is written as a threshold** (v2 plan §2.1, user
 * decision 2026-08-10). `INSTANCE_ACCESS_RESOURCES.inbox` declares
 * `none < metadata < identity < read < admin` with **no `edit` rung, on purpose**
 * — mail's `read` already confers acting (reply, assign), so the only tier above
 * it is managing the mailbox itself. This gate previously asked
 * `canEditInstance`, which on that sparse ladder resolves to `admin` and made
 * unsubscribe exactly as strict as authoring a standing filter; §7.1 designed it
 * as the LOOSER of the two, and the divergence had silently collapsed. A
 * one-shot command against a list is acting on mail, so it sits with reply and
 * assign at `read`. Authoring is unchanged: an unattended standing mutation is a
 * different kind of act.
 *
 * It stays a THRESHOLD (`canViewInstance`, i.e. `>= read`) rather than a literal
 * rung comparison, so a later insertion into the mail ladder moves this gate
 * with it instead of leaving it pinned to a name.
 */
export function canUnsubscribeOnInbox(
  inbox: UnsubscribeInbox,
  userId: string,
  capabilities: UnsubscribeAuthorityCapabilities
): boolean {
  if (inbox.entityDefinitionKey === 'personal_inbox') return inbox.ownerUserId === userId
  if (inbox.isPersonal) return inbox.ownerUserId === userId

  return capabilities.canViewInstance('inbox', inbox.id)
}

/**
 * {@link canUnsubscribeOnInbox}, as an assertion.
 *
 * @throws ForbiddenError — mapped to a 403 by `auxxErrorMiddleware`. Never a
 * `TRPCError`: this predicate is equally callable from a worker.
 */
export function assertCanUnsubscribe(
  inbox: UnsubscribeInbox,
  userId: string,
  capabilities: UnsubscribeAuthorityCapabilities
): void {
  if (!canUnsubscribeOnInbox(inbox, userId, capabilities)) {
    throw new ForbiddenError("You don't have permission to unsubscribe this inbox.")
  }
}

/**
 * Does an unsubscribe on this inbox need the blast-radius confirm and the audit
 * row (§7.1, invariant 11)?
 *
 * True for shared inboxes: *"This stops these emails for everyone using
 * Support."* The router passes the answer to `executeUnsubscribe` as
 * `isSharedInbox` — lib never derives it, because deriving authority-adjacent
 * facts inside lib is how permission logic leaks in.
 */
export function isSharedInbox(inbox: UnsubscribeInbox): boolean {
  return inbox.entityDefinitionKey !== 'personal_inbox' && !inbox.isPersonal
}
