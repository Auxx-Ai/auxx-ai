// apps/web/src/server/lib/mail-filter-authoring-access.ts

import { getOrgCache } from '@auxx/lib/cache'
import { ForbiddenError, NotFoundError } from '@auxx/lib/errors'
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
 * {@link assertCanAuthorMailFilters} / {@link assertCanMutateMailFilter} against
 * the same map. They cannot drift, which is what invariant 11 asks for now that
 * the `settings/rules` page guard is gone and the router is the only gate left.
 *
 * The two asserts differ ONLY in the shape of the refusal, never in who is
 * refused — see {@link assertCanMutateMailFilter}.
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
   * Every inbox in the org whose EXISTENCE is not private — i.e. every inbox on
   * the shared `inbox` def, authorable or not.
   *
   * This set decides the SHAPE of a refusal, never who is refused
   * (`plans/mail-filter/04-v2-plan.md` §1.3, V6). §5.1 says a personal filter
   * you do not own must be indistinguishable from a filter that does not exist,
   * so refusing one has to read as 404 — while a shared inbox is org inventory
   * the caller can already see, and answering 404 there would hide the one thing
   * they can act on ("ask for `automationRules.manage`").
   *
   * The legacy-marker row is EXCLUDED for the same reason
   * {@link canAuthorOnInbox} excludes it: between entity migration 059 and data
   * migration 060 a private mailbox still sits on the shared def, and disclosing
   * it by def alone would name somebody's personal mailbox. The marker narrows
   * here too — it can only ever move a row from "disclosable" to "private".
   */
  disclosableInboxIds: Set<string>
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
    disclosableInboxIds: new Set(
      inboxes
        .filter((inbox) => inbox.entityDefinitionKey !== 'personal_inbox' && !inbox.isPersonal)
        .map((inbox) => inbox.id)
    ),
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
 * The INBOX-ADDRESSED assert: the caller named the inbox itself (create,
 * reorder, previewMatchCount, a `move-inbox` destination, a prompt dismissal),
 * so the refusal is about that inbox and 403 is the honest answer. The
 * FILTER-addressed paths go through {@link assertCanMutateMailFilter} instead,
 * which has one more thing to protect.
 *
 * Called by EVERY mutating procedure rather than once at create. Rights change
 * after a filter is written and an inbox can be moved between definitions, so
 * authorization is re-derived on each write from the state it is being written
 * against.
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

/**
 * The §5.1 branch again, refusing in the shape the ADDRESSED RESOURCE allows
 * (V6, `plans/mail-filter/04-v2-plan.md` §1.3):
 *
 * ```
 *   authorable                         →  allowed
 *   on a shared inbox                  →  403, the caller can see the inbox
 *   on someone else's personal inbox   →  404, indistinguishable from an id
 *   (incl. the legacy-marker row on       that has no row at all
 *    the shared def)
 * ```
 *
 * One body, two exported wrappers, differing only in the not-found MESSAGE —
 * because the refusal must never disclose more than the caller already knows,
 * and the message is the last place that could leak it.
 */
function assertAuthorableOrDisclose(
  authority: MailFilterAuthority,
  inboxId: string,
  notFoundMessage: string,
  forbiddenMessage: string
): AuthorableInbox {
  const inbox = authority.byId.get(inboxId)
  if (inbox) return inbox
  if (authority.disclosableInboxIds.has(inboxId)) {
    throw new ForbiddenError(forbiddenMessage)
  }
  throw new NotFoundError(notFoundMessage)
}

/**
 * The §5.1 branch, for a write addressed by FILTER id — update, setEnabled,
 * delete, applyRetroactively (V6, `plans/mail-filter/04-v2-plan.md` §1.3).
 *
 * Identical in WHO it refuses to {@link assertCanAuthorMailFilters}; different
 * in WHAT the refusal admits — see {@link assertAuthorableOrDisclose}.
 *
 * §5.1 promises that a personal filter is never disclosed to anyone else, and
 * `list` / `get` / `runs` / `undoRun` all keep that promise by answering
 * not-found. A 403 here broke it: it is an existence oracle for a guessed CUID,
 * confirming that a colleague's private mailbox holds that filter. Flattening
 * the shared case into 404 as well would over-correct — that filter IS visible
 * inventory to a member who can see the inbox, and "you need permission" is the
 * actionable answer rather than a lie.
 *
 * @throws NotFoundError when the filter sits on a personal inbox that is not the
 *   caller's — same class and same message as a filter that does not exist.
 * @throws ForbiddenError when it sits on a shared inbox the caller cannot author
 *   on.
 */
export function assertCanMutateMailFilter(
  authority: MailFilterAuthority,
  filter: { inboxId: string }
): AuthorableInbox {
  return assertAuthorableOrDisclose(
    authority,
    filter.inboxId,
    'Filter not found',
    "You don't have permission to manage filters for this inbox."
  )
}

/**
 * The same authority, for per-inbox AUTOMATION SETTINGS that are not filters —
 * today the mail-classification opt-in
 * (`plans/mail-filter/05-mail-classification-plan.md` §5).
 *
 * Deliberately this module and not a second rule: §5 says the opt-in uses "the
 * same gate that governs authoring a filter on that inbox", because turning on
 * inference that bills the org and reads colleagues' mail is at least as
 * consequential as writing a filter. A parallel check here would be a second
 * place for the personal-inbox branch to rot.
 *
 * {@link assertCanAuthorMailFilters} is the wrong wrapper even though the caller
 * addresses an inbox id: its blanket 403 would confirm, to any member who can
 * guess a CUID, that a colleague's private mailbox exists. Personal mailboxes
 * are never disclosed (invariant 11 / §5.1), so an unauthorable personal inbox
 * answers 404 here just as a filter on one does.
 *
 * @throws NotFoundError when the inbox is personal and not the caller's.
 * @throws ForbiddenError when it is a shared inbox the caller cannot author on.
 */
export function assertCanConfigureInboxAutomation(
  authority: MailFilterAuthority,
  inboxId: string
): AuthorableInbox {
  return assertAuthorableOrDisclose(
    authority,
    inboxId,
    'Inbox not found',
    "You don't have permission to manage automation for this inbox."
  )
}
