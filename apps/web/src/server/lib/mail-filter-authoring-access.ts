// apps/web/src/server/lib/mail-filter-authoring-access.ts

import { getOrgCache } from '@auxx/lib/cache'
import { ForbiddenError } from '@auxx/lib/errors'
import type { Inbox } from '@auxx/lib/inboxes'
import type { InstanceAccessKey } from '@auxx/lib/permissions/capabilities/instance-access'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'

/**
 * THE authority for "may this member author mail filters on this inbox"
 * (plans/mail-filter/02-mail-filters-plan.md §5.1, invariants 11 / 15 / 16).
 *
 * ```
 *   personal_inbox owned by the caller  →  allowed. NO permission key.
 *   shared inbox (`inbox` def)          →  automationRules.manage AND inbox write
 * ```
 *
 * It lives in the app layer, not in `packages/lib`: lib holds zero permission
 * checks by house rule, and `@auxx/lib/mail-filters` is deliberately a pure
 * data module that takes the allowed inbox id set as an argument.
 *
 * **One computation, three consumers.** `mailFilters.list` scopes its SQL with
 * {@link MailFilterAuthority.inboxIds}, `mailFilters.authorableInboxes` renders
 * {@link MailFilterAuthority.inboxes}, and every mutation asserts through
 * {@link assertCanAuthorMailFilters} against the same map. They cannot drift,
 * which is what invariant 11 asks for now that the `settings/rules` page guard
 * is gone and the router is the only gate left.
 *
 * Deep permission imports rather than the `@auxx/lib/permissions` barrel: the
 * barrel hangs under vitest (the `snippet-instance-access.ts` precedent), and
 * the router tests import this module transitively.
 */

/** An inbox the caller may author filters on — exactly what the UI needs. */
export interface AuthorableInbox {
  id: string
  name: string
  /**
   * DEF-KEYED, never the `isPersonal` marker (invariant 16), and load-bearing
   * beyond display: it selects the §5.2 limit branch, and the two counters in
   * `@auxx/lib/mail-filters/limits` split on `EntityDefinition.entityType ===
   * 'personal_inbox'` too. Deriving it from the marker here would gate creates
   * against one ceiling while the counters measured the other.
   */
  isPersonal: boolean
}

/**
 * The two `CapabilitySet` reads this module makes, as a structural type.
 *
 * Structural rather than `CapabilitySet` itself so a test can state the
 * premise ("holds the key, writes to no inbox") without composing a real
 * capability blob.
 */
export interface MailFilterAuthorityCapabilities {
  can(key: PermissionKey): boolean
  canEditInstance(key: InstanceAccessKey, instanceId: string): boolean
}

/** The caller's authorable set, resolved once per request. */
export interface MailFilterAuthority {
  /** Every inbox the caller may author on, in the cache's order. */
  inboxes: AuthorableInbox[]
  /** The same set as an id list — the SQL scope for `listMailFilters`. */
  inboxIds: string[]
  /** Lookup for the per-mutation assert. */
  byId: Map<string, AuthorableInbox>
  /**
   * Whether the caller holds `automationRules.manage`. Carried on the authority
   * because invariant 15 needs it a second time, on the ACTION list: an author
   * without the key gets the six mail actions and never `run-agent` /
   * `run-workflow`, even on their own personal inbox.
   */
  hasAutomationKey: boolean
}

/**
 * The §5.1 branch for ONE inbox.
 *
 * The personal branch keys on the inbox's **definition**. Def membership is the
 * unforgeable half of the mail model (invariant 16) — a name, a flag or a field
 * can be written by anything that can write a FieldValue, a definition cannot.
 *
 * The legacy-marker case narrows and never widens. Between entity migration 059
 * and data migration 060 a personal mailbox can still sit on the SHARED `inbox`
 * def while carrying the retired `inbox_is_personal` marker, and that def's
 * absent-row fallback is the member's `Area.inboxes` level — so an admin
 * composing `Inboxes: Full` would resolve `admin` on somebody's private mailbox
 * and could author filters that mutate their mail. `settingsInboxesForUser`
 * fails closed on exactly this row; so does this. The marker is only ever
 * allowed to REMOVE the shared branch, never to grant the personal one, which
 * is what keeps invariant 16 true: personal-ness still cannot be forged, it can
 * only be self-declared into a stricter rule.
 */
function canAuthorOnInbox(
  inbox: Inbox,
  userId: string,
  hasAutomationKey: boolean,
  capabilities: MailFilterAuthorityCapabilities
): boolean {
  if (inbox.entityDefinitionKey === 'personal_inbox') return inbox.ownerUserId === userId
  if (inbox.isPersonal) return inbox.ownerUserId === userId

  if (!hasAutomationKey) return false
  /**
   * "Inbox write, rung `edit`+" — stated as the threshold the plan states, not
   * as the rung it currently resolves to.
   *
   * The mail vocabulary is sparse: `INSTANCE_ACCESS_RESOURCES.inbox` declares
   * `none < metadata < identity < read < admin` with NO `edit`, because mail's
   * `read` already confers replying and assigning. `canEditInstance` asks for
   * `>= edit` on the ordinal ladder, so on this inbox today the only rung that
   * satisfies it is `admin` — i.e. "may manage the inbox itself", which is the
   * right authority for a rule that rewrites every message landing in a shared
   * mailbox. Writing `canAdminInstance` instead would hard-code that
   * coincidence; if an `edit` rung is ever inserted into the mail ladder, this
   * gate should follow the plan's threshold rather than silently stay at
   * `admin`.
   */
  return capabilities.canEditInstance('inbox', inbox.id)
}

/**
 * Compute the caller's authorable set from an inbox list. Pure — the I/O lives
 * in {@link loadMailFilterAuthority}.
 */
export function mailFilterAuthority(args: {
  inboxes: readonly Inbox[]
  userId: string
  capabilities: MailFilterAuthorityCapabilities
}): MailFilterAuthority {
  const { inboxes, userId, capabilities } = args
  const hasAutomationKey = capabilities.can(PermissionKey.automationRulesManage)

  const authorable = inboxes.flatMap<AuthorableInbox>((inbox) =>
    canAuthorOnInbox(inbox, userId, hasAutomationKey, capabilities)
      ? [
          {
            id: inbox.id,
            name: inbox.name,
            isPersonal: inbox.entityDefinitionKey === 'personal_inbox',
          },
        ]
      : []
  )

  return {
    inboxes: authorable,
    inboxIds: authorable.map((inbox) => inbox.id),
    byId: new Map(authorable.map((inbox) => [inbox.id, inbox])),
    hasAutomationKey,
  }
}

/** The context slice {@link loadMailFilterAuthority} reads. */
export interface MailFilterAuthorityCtx {
  session: { organizationId: string; userId: string }
  capabilities: MailFilterAuthorityCapabilities
}

/**
 * {@link mailFilterAuthority} over the `inboxes` org cache — one cache read, no
 * DB query, and the capability blob is already resolved by `capabilityProcedure`.
 */
export async function loadMailFilterAuthority(
  ctx: MailFilterAuthorityCtx
): Promise<MailFilterAuthority> {
  const inboxes = await getOrgCache().get(ctx.session.organizationId, 'inboxes')
  return mailFilterAuthority({
    inboxes,
    userId: ctx.session.userId,
    capabilities: ctx.capabilities,
  })
}

/**
 * Assert the §5.1 branch for one inbox and return its authorable descriptor.
 *
 * Called by EVERY mutating procedure — create, update, setEnabled, reorder and
 * delete — rather than once at create. Rights change after a filter is written
 * and an inbox can be moved between definitions, so authorization is re-derived
 * on each write from the state it is being written against.
 *
 * @throws ForbiddenError when the caller may not author on this inbox.
 */
export function assertCanAuthorMailFilters(
  authority: MailFilterAuthority,
  inboxId: string
): AuthorableInbox {
  const inbox = authority.byId.get(inboxId)
  if (!inbox) {
    throw new ForbiddenError("You don't have permission to manage filters for this inbox.")
  }
  return inbox
}
