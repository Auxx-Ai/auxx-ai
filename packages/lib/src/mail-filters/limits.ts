// packages/lib/src/mail-filters/limits.ts
// The counters behind the `mailFiltersLimit` plan limit and the flat per-user
// personal cap (plan §5.2).

import { type Database, schema } from '@auxx/database'
import { and, count, eq, isNull, ne, or } from 'drizzle-orm'
import type { InboxDef } from '../resource-access/mail-sharing-defs'

/**
 * The personal-mailbox definition.
 *
 * Typed as {@link InboxDef} so it stays tied to the canonical mail vocabulary in
 * `resource-access/mail-sharing-defs.ts`. Invariant 16: personal-ness keys on
 * the inbox's **definition**, never on a name, a flag or a field. The retired
 * `inbox_is_personal` marker is exactly the kind of forgeable signal this rule
 * exists to avoid — and `EntityDefinition.entityType` is what migration 059
 * writes and what every other def-membership test reads.
 */
const PERSONAL_INBOX_DEF: InboxDef = 'personal_inbox'

/**
 * The single counter behind the `mailFiltersLimit` plan limit.
 *
 * Exported so the create gate (`mailFilter.create`) and `OverageDetectionService`
 * read ONE number rather than growing two queries that drift — the
 * `countBillableChannels` / `countSequencesUsed` precedent. Two counters that
 * disagree produce the worst version of a limit: a create that is refused while
 * the billing surface says there is room.
 *
 * Two exclusions, for two different reasons:
 *
 * - **`templateKey IS NOT NULL`** — seeded suggested filters are provisioned by
 *   us. Counting them would put every org several filters toward its cap on day
 *   one, for rows the org never asked for. The fix for "seeded rows eat the cap"
 *   is excluding them here, never raising the limit. (Unlike seeded sequences
 *   these ARE deletable, so this is not the "no action available to get back
 *   under the cap" trap — it is simply not the customer's allowance to spend.)
 * - **personal-inbox filters** — every member may filter their own mailbox
 *   (D14), so pooling those into one org allowance would let the first member to
 *   write fifty of them block everyone else. They are capped per user instead by
 *   {@link countPersonalMailFilters}.
 *
 * Disabled filters DO count. A slot is a slot, and metering only enabled rows
 * invites disable-to-dodge churn.
 *
 * The shared-vs-personal test is a join through the inbox instance to its
 * definition. `entityType` is nullable on `EntityDefinition`, so the predicate is
 * written NULL-tolerantly: anything that is not demonstrably the personal def
 * counts, which errs toward charging rather than toward a silently uncapped org.
 */
export async function countBillableMailFilters(
  db: Database,
  organizationId: string
): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(schema.MailFilter)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.MailFilter.inboxId))
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.MailFilter.organizationId, organizationId),
        isNull(schema.MailFilter.templateKey),
        or(
          isNull(schema.EntityDefinition.entityType),
          ne(schema.EntityDefinition.entityType, PERSONAL_INBOX_DEF)
        )
      )
    )

  return result?.value ?? 0
}

/**
 * The counter behind the flat `MAX_PERSONAL_MAIL_FILTERS` ceiling (§5.2).
 *
 * Counts the filters this user authored on personal mailboxes. Authorship is the
 * right key even though the cap is described as "their own personal inboxes":
 * the §5.1 personal branch only lets a member author on the mailbox they own, so
 * `createdByUserId` + the personal def IS that set — and reading it this way
 * avoids resolving `inbox_owner_user_id` FieldValues on the create path.
 *
 * Seeded rows are excluded here too: a suggestion we provisioned must not push a
 * member into their own abuse ceiling.
 */
export async function countPersonalMailFilters(
  db: Database,
  organizationId: string,
  userId: string
): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(schema.MailFilter)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.MailFilter.inboxId))
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.MailFilter.organizationId, organizationId),
        eq(schema.MailFilter.createdByUserId, userId),
        isNull(schema.MailFilter.templateKey),
        eq(schema.EntityDefinition.entityType, PERSONAL_INBOX_DEF)
      )
    )

  return result?.value ?? 0
}
