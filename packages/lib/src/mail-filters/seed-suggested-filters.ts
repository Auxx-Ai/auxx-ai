// packages/lib/src/mail-filters/seed-suggested-filters.ts
// Starter suggested mail filters (plans/mail-filter/02-mail-filters-plan.md §9 phase 5) —
// a handful of disabled, plain user-editable filters seeded on the org's default SHARED
// inbox, giving a new org a starting point for inbound triage. Idempotent on
// `(organizationId, templateKey)` (`MailFilter_organizationId_templateKey_idx`), mirroring
// `record-rules/seed-suggested-rules.ts`: skips silently (never overwrites) any templateKey
// the org already has, including one the user has since edited or enabled.
//
// Goes through `assertFilterShape` (the same validator the tRPC create/update path uses)
// before insert — NOT a raw unvalidated insert — but writes the row directly (rather than
// calling `createMailFilter`) because that store helper doesn't accept `templateKey`.
//
// FOUR RULES THIS FILE EXISTS TO KEEP:
//
//  1. **Seeded disabled.** A suggestion that silently starts mutating a customer's mail on
//     day one is exactly the surprise the plan is careful to avoid (D18: nothing
//     mass-mutates a freshly connected mailbox without a click). `enabled: false` is the
//     record-rules precedent and is not negotiable here.
//  2. **Only conditions the evaluator can compile.** `condition-query-builder.ts` DROPS a
//     condition it cannot dispatch and logs a warning — the filter then matches *more*
//     mail, not less. Every `fieldId` below is in that builder's dispatch table and every
//     operator is one its field builder accepts — `seed-suggested-filters.test.ts` reads
//     both out of the builder's own source, so drift there fails here.
//  3. **Only `set-status` / `add-tag` / `suppress-automations`.** `run-agent` and
//     `run-workflow` require `automationRules.manage` server-side (invariant 15) AND a real
//     agent-trigger / workflow-app id, neither of which exists at seed time.
//  4. **Never invent a tag.** A template that wants one resolves an EXISTING seeded tag by
//     display name and is skipped entirely when that tag is absent, rather than writing a
//     `tagIds` entry pointing at nothing.
//
// Some of the catalog exists because a DETERMINISTIC rule beat an inference:
// `plans/mail-filter/06-mail-categories-rework-plan.md` D2 retires `Newsletter` and
// `Notification` as AI labels precisely because both are answerable from headers this
// file can match on for free. `suggested:mailing-list-mail` is that replacement.
//
// Seeded rows do NOT consume the customer's `mailFiltersLimit` allowance —
// `countBillableMailFilters` excludes `templateKey IS NOT NULL` (§5.2). They ARE deletable,
// unlike seeded sequences; see the note on `deleteMailFilter`.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { ConditionGroup } from '../conditions/types'
import type { InboxDef } from '../resource-access/mail-sharing-defs'
import { assertFilterShape } from './mutations'
import type { MailFilterAction } from './types'

const logger = createScopedLogger('mail-filters-seed-suggested')

/**
 * The org-shared mailbox definition.
 *
 * Typed as {@link InboxDef} so it stays tied to the canonical mail vocabulary in
 * `resource-access/mail-sharing-defs.ts`. Invariant 16: personal-ness keys on the inbox's
 * **definition**, never on a name or a flag — so "the org's default inbox" is resolved as
 * "the oldest live instance on the `inbox` def", and a member's `personal_inbox` can never
 * be picked up by accident. Suggestions belong on the shared mailbox: a personal one is the
 * member's own, and we do not provision filters into it.
 */
const SHARED_INBOX_DEF: InboxDef = 'inbox'

/** The `EntityDefinition.entityType` tags live on. */
const TAG_DEF = 'tag'

/** A starter filter, before its tag (if any) is resolved against the org. */
export interface SuggestedMailFilterTemplate {
  /** `suggested:<slug>` — the idempotency key, unique per org when set. */
  templateKey: string
  name: string
  conditions: ConditionGroup[]
  /**
   * Display name of a seeded tag this template needs. The template is SKIPPED when the org
   * has no tag by that name (renamed, deleted, or an org seeded before that tag existed) —
   * an `add-tag` action pointing at a tag id that does not exist would fail at fire time,
   * once per matching message, forever.
   */
  requiredTagName?: string
  /**
   * The action list. Takes the resolved `requiredTagName` instance id, so the tag-bearing
   * templates stay declarative and the whole catalog stays validatable in a unit test.
   */
  buildActions: (tagId?: string) => MailFilterAction[]
}

/**
 * `from` matches on the sender's email identifier via `ILIKE '%value%'`
 * (`buildSenderQuery`), so a bare local-part fragment like `no-reply@` is the whole
 * predicate — no domain, no anchoring.
 */
function fromContains(id: string, value: string) {
  return { id, fieldId: 'from', operator: 'contains' as const, value }
}

/** `subject` matches on `Thread.subject` via `ILIKE '%value%'` (`buildSubjectQuery`). */
function subjectContains(id: string, value: string) {
  return { id, fieldId: 'subject', operator: 'contains' as const, value }
}

/**
 * `list` matches on `Message.listId` — the normalized `List-Id` header derived at
 * ingest (`ingest/filtering/bulk-mail.ts:parseListId`), lowercased and stripped to
 * the bare identity (`ACME News <news.acme.com>` → `news.acme.com`).
 *
 * This is the STABLE bulk-mail identity: it survives VERP and per-campaign
 * from-addresses, both of which defeat any `from contains` fragment. `not empty`
 * means "some message in this thread carries a List-Id", i.e. it came from a real
 * mailing list.
 */
function listNotEmpty(id: string) {
  // `value` is required by `Condition` and ignored by `buildMessageTextColumnQuery`
  // for `empty` / `not empty`; `''` is the convention `mail-suggestions/mine.ts`
  // already uses for the value-less operators.
  return { id, fieldId: 'list', operator: 'not empty' as const, value: '' }
}

/** `list` substring match on `Message.listId` via `ILIKE '%value%'`. */
function listContains(id: string, value: string) {
  return { id, fieldId: 'list', operator: 'contains' as const, value }
}

/**
 * The starter suggested filters. All seeded `enabled: false`, `stopProcessing: false`, on
 * the org's default shared inbox.
 *
 * Each one is deliberately conservative — the worst case of a user enabling it unread is a
 * reversible archive or an extra tag, never a delete, a spam report, or an automation run:
 *
 * - **automated-notifications** — writes no thread state at all. `suppress-automations`
 *   only tells the gate to skip AI/automation for robot mail, which is the single safest
 *   useful thing a filter can do.
 * - **mailing-list-mail** — the same, on the deterministic signal rather than an
 *   address fragment. See its own note below.
 * - **bulk-newsletters** — `ARCHIVED` is mail's "done" (never `TRASH`/`SPAM`, which are
 *   destructive and provider-visible), paired with `suppress-automations` because nobody
 *   wants an agent drafting a reply to a marketing blast. Undo restores the prior status.
 * - **billing-mail** — additive only. Tagging changes no status, no assignee, no inbox.
 * - **key-domain** — the "edit me" starter. `@example.com` is IANA-reserved and receives no
 *   real mail, so the filter matches nothing until the user swaps in their own domain; it
 *   exists to show the shape, and it is additive-only too.
 */
export const SUGGESTED_MAIL_FILTER_TEMPLATES: SuggestedMailFilterTemplate[] = [
  {
    templateKey: 'suggested:automated-notifications',
    name: 'Skip AI on automated notifications',
    conditions: [
      {
        id: 'g1',
        logicalOperator: 'OR',
        conditions: [
          fromContains('c1', 'no-reply@'),
          fromContains('c2', 'noreply@'),
          fromContains('c3', 'do-not-reply@'),
          fromContains('c4', 'donotreply@'),
        ],
      },
    ],
    buildActions: () => [{ type: 'suppress-automations' }],
  },
  {
    // ── The deterministic replacement for the retired `Notification` /
    //    `Newsletter` AI labels (categories plan 06 D2, §2.4). ──
    //
    // Both were answerable from a header, and 63% of recent inbound is already
    // flagged `machineMailTier = 'soft'` by exactly that deterministic rule
    // (06-plan §1.1). Spending an inference to conclude "this is a notification"
    // is the anti-pattern `05-mail-classification-plan.md` §3.1.1 was written
    // against, so it is a filter instead: free, exact, instant.
    //
    // ⚠️ `machineMailTier` itself is NOT a condition `condition-query-builder.ts`
    // dispatches — there is no `machineMailTier` case in its dispatch table, so
    // the tier the plan names cannot be matched on today. `list` is the signal
    // that IS in the vocabulary, and it is one of the two headers
    // (`ingest/filtering/machine-mail.ts:158`) that produce the `soft` tier in
    // the first place, so this filter selects a large, well-defined subset of
    // what the plan describes. Inventing a `machineMailTier` fieldId here would
    // be DROPPED silently and the filter would then match the whole inbox
    // (invariant 19).
    //
    // Suppress only — no status, no tag. §1.1's other warning applies: `soft` (and
    // `List-Id` with it) covers bulk marketing AND transactional notices in one
    // bucket, so this cannot tell a newsletter from a shipping notice. "Skip the
    // AI" is true of both; "archive it" is not, and that stays with the narrower
    // `bulk-newsletters` below.
    templateKey: 'suggested:mailing-list-mail',
    name: 'Skip AI on mailing-list mail',
    conditions: [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [listNotEmpty('c1')],
      },
    ],
    buildActions: () => [{ type: 'suppress-automations' }],
  },
  {
    templateKey: 'suggested:bulk-newsletters',
    name: 'Archive newsletters',
    conditions: [
      {
        id: 'g1',
        logicalOperator: 'OR',
        conditions: [
          fromContains('c1', 'newsletter@'),
          fromContains('c2', 'newsletters@'),
          fromContains('c3', 'marketing@'),
          fromContains('c4', 'mailer@'),
          // The same intent on the stable list identity (06-plan D2). A campaign
          // sender rotates its from-address (VERP, `bounce-1234@…`) far more often
          // than it renames its list, so these arms catch blasts the four
          // address fragments above miss entirely. Substring, not `not empty`:
          // this arm ARCHIVES, and "every mailing list" would sweep in
          // transactional list mail the tier cannot distinguish (§1.1).
          listContains('c5', 'news'),
          listContains('c6', 'marketing'),
          listContains('c7', 'campaign'),
          listContains('c8', 'promo'),
        ],
      },
    ],
    buildActions: () => [
      { type: 'suppress-automations' },
      { type: 'set-status', status: 'ARCHIVED' },
    ],
  },
  {
    templateKey: 'suggested:billing-mail',
    name: 'Tag billing email',
    requiredTagName: 'Billing',
    conditions: [
      {
        id: 'g1',
        logicalOperator: 'OR',
        conditions: [
          subjectContains('c1', 'invoice'),
          subjectContains('c2', 'receipt'),
          subjectContains('c3', 'payment'),
        ],
      },
    ],
    buildActions: (tagId) => [{ type: 'add-tag', tagIds: tagId ? [tagId] : [] }],
  },
  {
    templateKey: 'suggested:key-domain',
    name: 'Tag mail from a key domain',
    requiredTagName: 'VIP',
    conditions: [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [fromContains('c1', '@example.com')],
      },
    ],
    buildActions: (tagId) => [{ type: 'add-tag', tagIds: tagId ? [tagId] : [] }],
  },
]

/**
 * The org's default shared inbox — the oldest live instance on the `inbox` definition.
 *
 * Def-derived, never name-derived: `seedInboxes` calls it "Shared Inbox" today, but a user
 * may rename it, and matching on the name would silently stop seeding for every org that
 * did. `personal_inbox` instances cannot be selected here by construction.
 */
async function findDefaultSharedInboxId(
  db: Database,
  organizationId: string
): Promise<string | null> {
  const [inbox] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, SHARED_INBOX_DEF),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .orderBy(asc(schema.EntityInstance.createdAt))
    .limit(1)

  return inbox?.id ?? null
}

/**
 * Resolve the seeded tags the catalog asks for, by display name → instance id.
 *
 * `displayName` is the denormalized primary display value the tag CRUD path writes, so this
 * is one indexed read rather than a FieldValue join. Missing names simply do not appear in
 * the map, and their templates are skipped.
 */
async function resolveTagIdsByName(
  db: Database,
  organizationId: string,
  names: string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  if (names.length === 0) return resolved

  const rows = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, TAG_DEF),
        isNull(schema.EntityInstance.archivedAt),
        inArray(schema.EntityInstance.displayName, names)
      )
    )

  for (const row of rows) {
    // First row wins — duplicate tag names are possible and either is equally correct.
    if (row.displayName && !resolved.has(row.displayName)) resolved.set(row.displayName, row.id)
  }
  return resolved
}

/**
 * Seed the starter suggested mail filters for an org — idempotent on
 * `(organizationId, templateKey)`, skips any template the org already has (never overwrites
 * a user's edits). All rows land on the default shared inbox, `enabled: false`,
 * `stopProcessing: false`, `createdByUserId: null` (there is no human author).
 *
 * Busts the org's `mailFilters` cache key when — and only when — at least one row was
 * actually inserted, after the writes have committed.
 *
 * **Best-effort and never throws.** Org seeding must not fail because a suggestion did not
 * take: a missing shared inbox, a missing tag, a shape regression, a failed insert and a
 * failed cache bust each log and move on. No-ops (with a warning) when the org has no shared
 * inbox yet — the inbox seed runs in the same org-seeding pass, so this must be sequenced
 * after it
 * (`organization-seeder.ts`), and on the backfill path against a live org it should never
 * happen.
 */
export async function seedSuggestedMailFilters(
  db: Database,
  organizationId: string
): Promise<void> {
  let inserted = 0
  try {
    const inboxId = await findDefaultSharedInboxId(db, organizationId)
    if (!inboxId) {
      logger.warn('Skipping suggested mail-filter seed — no shared inbox for this organization', {
        organizationId,
      })
      return
    }

    const tagNames = [
      ...new Set(
        SUGGESTED_MAIL_FILTER_TEMPLATES.map((t) => t.requiredTagName).filter(
          (name): name is string => !!name
        )
      ),
    ]
    const tagIds = await resolveTagIdsByName(db, organizationId, tagNames)

    for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
      const [existing] = await db
        .select({ id: schema.MailFilter.id })
        .from(schema.MailFilter)
        .where(
          and(
            eq(schema.MailFilter.organizationId, organizationId),
            eq(schema.MailFilter.templateKey, template.templateKey)
          )
        )
        .limit(1)
      if (existing) continue

      const tagId = template.requiredTagName ? tagIds.get(template.requiredTagName) : undefined
      if (template.requiredTagName && !tagId) {
        logger.warn('Suggested mail-filter template needs a tag this org does not have — skipped', {
          organizationId,
          templateKey: template.templateKey,
          requiredTagName: template.requiredTagName,
        })
        continue
      }

      const actions = template.buildActions(tagId)

      try {
        assertFilterShape({ name: template.name, actions })
      } catch (error) {
        logger.error('Suggested mail-filter template failed shape validation — not seeded', {
          organizationId,
          templateKey: template.templateKey,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      try {
        await db.insert(schema.MailFilter).values({
          organizationId,
          inboxId,
          name: template.name,
          // Same scalar subquery `createMailFilter` uses: the seed appends to whatever the
          // inbox already has rather than colliding with a user's existing `order` values,
          // and each insert re-evaluates it so the templates land in catalog order.
          order: sql<number>`(
            SELECT COALESCE(MAX(${schema.MailFilter.order}), -1) + 1
            FROM ${schema.MailFilter}
            WHERE ${schema.MailFilter.organizationId} = ${organizationId}
              AND ${schema.MailFilter.inboxId} = ${inboxId}
          )`,
          conditions: template.conditions,
          actions,
          stopProcessing: false,
          enabled: false,
          createdByUserId: null,
          templateKey: template.templateKey,
        })
        inserted += 1
      } catch (error) {
        logger.error('Failed to seed suggested mail filter', {
          organizationId,
          templateKey: template.templateKey,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    logger.error('Suggested mail-filter seed failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // ⚠️ AFTER the writes, never inside one. The `mailFilters` org-cache key is an
  // array of the org's filters; seeding rows without busting it leaves that array
  // stale until TTL. Harmless while every seeded row is `enabled: false` and the
  // settings list reads the DB — and it stops being harmless the moment anything
  // enables one, which is exactly the kind of latent staleness nobody attributes
  // back to the seeder. Only fired when a row actually landed: a no-op second
  // pass must not flush the org's cache.
  //
  // Lazy-imported (the cache barrel drags redis + the invalidation graph) and
  // swallowed: the never-throws contract holds for a failed cache bust too.
  if (inserted > 0) {
    try {
      const { onCacheEvent } = await import('../cache')
      await onCacheEvent('mail-filter.changed', { orgId: organizationId })
    } catch (error) {
      logger.warn('Failed to invalidate the mail-filter cache after seeding', {
        organizationId,
        inserted,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
