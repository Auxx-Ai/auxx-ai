// packages/lib/src/seed/ai-category-tags.ts
//
// The five starter mail categories (plans/mail-filter/05-mail-classification-plan.md §2.4)
// and the one function that seeds them — called from `OrganizationSeeder.seedTags` for new
// orgs and from `scripts/backfill-ai-category-tags.ts` for existing ones, so both paths seed
// exactly the same rows.
//
// FIVE RULES THIS FILE EXISTS TO KEEP:
//
//  1. **Ordinary tags, never system tags** (C4). `tag-system-guard.ts` rejects every edit to
//     a system tag's title/description/emoji/color/parent AND rejects its delete. Under C3
//     the `tag_description` IS the classifier's instruction for that label — the tuning
//     surface — so seeding these as system tags would freeze the one field the whole feature
//     depends on. `is_system_tag: false`, deliberately and explicitly.
//  2. **Descriptions are prompt text, not blurbs.** The model reads them verbatim as the
//     label's definition. They are written as instructions ("anything about invoices,
//     charges, refunds…"), with the precedence hints that keep the overlapping pairs
//     (Notification vs Billing, Notification vs Newsletter) decidable.
//  3. **No `Spam` category** (C6). `set-status: SPAM` already exists and hard machine mail is
//     skipped upstream; a Spam tag beside a spam status is two ways to say one thing.
//  4. **Seeding never enables classification.** These rows only make a label *available*.
//     Nothing is classified until an inbox is opted in, which is a separate switch.
//  5. **Never touch a USER'S tag.** A title the org already uses is skipped whole — no
//     re-parenting, no description overwrite, no flag flip. A user's taxonomy is theirs, and
//     re-running the seed must be a no-op.
//
//     ONE EXCEPTION, added 2026-08-10: a pre-existing `Billing`/`Sales`/`Support` carrying
//     `is_system_tag = true` is one WE seeded, and it is frozen by `rejectIfSystemTag` — so
//     the org could never tune the classifier instruction that rule 1 exists to protect.
//     `adoptLegacySystemStarter` converts those in place. The discriminator is the flag, not
//     the title: a user-created tag of the same name is left entirely alone, because a title
//     collision is not consent.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { UnifiedCrudHandler } from '../resources/crud'
import { type RecordId, toRecordId } from '../resources/resource-id'

const logger = createScopedLogger('ai-category-tags')

/** The `EntityDefinition.entityType` tags live on. */
const TAG_DEF = 'tag'

/** Thread-scoped only (Q3): article tags exist for KB content, not for mail. */
const THREAD_SCOPE = 'thread'

/** One starter category, before it is written. */
export interface AiCategoryTagSeed {
  title: string
  /**
   * The classifier's instruction for this label — read verbatim into the prompt (C3).
   * Never empty: a bare title classifies measurably worse.
   */
  description: string
  emoji: string
  color: string
}

/**
 * The group the five starters hang under, so they read as one set in the picker instead of
 * scattering through the org's taxonomy.
 *
 * An ordinary tag itself, and NOT eligible: "Mail Categories" is a container, and an
 * eligible container would be offered to the model as a label it could apply.
 */
export const AI_CATEGORY_PARENT_TAG: AiCategoryTagSeed = {
  title: 'Mail Categories',
  description:
    'Grouping for the categories the AI classifier may apply to inbound mail. Not applied to mail itself.',
  emoji: '📬',
  color: 'blue',
}

/**
 * The five starters. Exactly these — see rule 3 on the absent `Spam`.
 *
 * Each description is prompt text. Editing one retunes the classifier for that org, which is
 * the point: these are starting definitions, not fixed ones.
 */
export const AI_CATEGORY_STARTER_TAGS: AiCategoryTagSeed[] = [
  {
    title: 'Sales',
    description:
      'A prospective or existing customer with buying intent: pricing, quotes, plans, stock or availability, product fit, a demo, or expanding an existing order. Pre-purchase interest — not a problem with something already bought.',
    emoji: '💼',
    color: 'pink',
  },
  {
    title: 'Support',
    description:
      'The sender needs help with something they already have: a fault, an error, a how-to question, a delivery or order-status chase, a return or a complaint. Something is broken, missing, or not understood.',
    emoji: '🆘',
    color: 'red',
  },
  {
    title: 'Billing',
    description:
      'Anything about money owed or paid: invoices, charges, refunds, payment methods, subscription or plan fees, failed payments, dunning, receipts and tax documents.',
    emoji: '💳',
    color: 'green',
  },
  {
    title: 'Newsletter',
    description:
      'Bulk marketing or editorial mail broadcast to a list — product news, promotions, offers, digests, event invitations. Written for many recipients rather than for us, and needs no reply.',
    emoji: '📰',
    color: 'amber',
  },
  {
    title: 'Notification',
    description:
      'Automated machine mail generated by a system rather than written by a person: service alerts, account and security notices, monitoring or build results, calendar and shipping updates, confirmations of an automated action. If it is about money owed or paid, prefer Billing; if it is bulk marketing, prefer Newsletter.',
    emoji: '🔔',
    color: 'teal',
  },
]

/** What one seed pass did, for the caller's log line. */
export interface AiCategoryTagSeedResult {
  /** Titles created by this pass. */
  created: string[]
  /** Titles the org already had that were left untouched (user-owned, or already adopted). */
  skipped: string[]
  /** Titles that existed as LEGACY SYSTEM tags and were converted in place (§12.5.1). */
  adopted: string[]
}

/**
 * Convert one pre-existing **legacy system** starter tag into an ordinary, tunable one.
 *
 * ## Why this exists
 *
 * `seedTags` historically created `Billing`, `Sales` and `Support` as SYSTEM tags. System
 * tags are frozen by `rejectIfSystemTag` — `tag_description` included — and that description
 * IS the classifier's instruction for the label (plan C3). So without this, an org created
 * before mail classification would carry three starters that can be flagged eligible but can
 * NEVER be tuned, and would classify as bare titles with no UI anywhere able to fix it.
 *
 * ## What it will and will not touch
 *
 * **Only tags carrying `is_system_tag = true`** — i.e. ones we seeded. A user's own tag that
 * happens to be called `Sales` is theirs: its description is left alone and it is not made
 * eligible. Title collision is not consent.
 *
 * ## Ordering is load-bearing
 *
 * The flag is cleared in its own write, BEFORE the description write. `rejectIfSystemTag`
 * reads the tag's CURRENT `is_system_tag` at hook time, so once the flag is false the
 * description write passes the guard normally — no bypass, no second privilege hole. Doing
 * both in one call would trip the guard on the description.
 *
 * ⚠️ Setting `tag_ai_classify = true` is also what stops entity migration `014` re-freezing
 * these three by title on its next run (`014-backfill-system-tags.ts` → `excludeAiClassifyTags`).
 * That migration is REPLAYED, not ledger-guarded, so adoption without the flag would silently
 * undo itself.
 */
async function adoptLegacySystemStarter(
  db: Database,
  args: {
    organizationId: string
    userId: string
    tagDefId: string
    instanceId: string
    seed: AiCategoryTagSeed
    parentRecordId: RecordId
  }
): Promise<'adopted' | 'left-alone'> {
  const { organizationId, userId, tagDefId, instanceId, seed, parentRecordId } = args

  const [systemField] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, tagDefId),
        eq(schema.CustomField.systemAttribute, 'is_system_tag')
      )
    )
    .limit(1)

  if (!systemField) return 'left-alone'

  const [flagRow] = await db
    .select({ valueBoolean: schema.FieldValue.valueBoolean })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, systemField.id),
        eq(schema.FieldValue.entityId, instanceId)
      )
    )
    .limit(1)

  // Not one of ours — a user-created tag that happens to share the title. Hands off.
  if (flagRow?.valueBoolean !== true) return 'left-alone'

  const recordId = toRecordId(tagDefId, instanceId)
  const seedOpts = { skipEvents: true }

  // 1. Unfreeze. Needs the same bypass the create path uses, because `is_system_tag` is
  //    `creatable: false` and `dropUnauthorizedSystemFlag` drops unauthorized writes.
  const unfreeze = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    bypassFieldGuards: new Set(['is_system_tag']),
  })
  // NB `update` is (recordId, values, MODES, options) — options is the FOURTH
  // arg, unlike `create`. Passing seedOpts third silently lands in the
  // array-field mode map.
  await unfreeze.update(recordId, { is_system_tag: false }, undefined, seedOpts)

  // 2. Now an ordinary tag, so the guard lets these through with no bypass at all.
  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  await handler.update(
    recordId,
    {
      tag_description: seed.description,
      tag_parent: parentRecordId,
      tag_scope: THREAD_SCOPE,
      tag_ai_classify: true,
    },
    undefined,
    seedOpts
  )

  logger.info('Adopted legacy system tag as an AI category starter', {
    organizationId,
    title: seed.title,
    instanceId,
  })
  return 'adopted'
}

/**
 * Seed the five starter mail categories (plus their parent group) for one organization.
 *
 * Idempotent by tag title: an org that already has a tag called `Billing` keeps the one it
 * has, untouched, and no duplicate is written. A second pass creates nothing.
 *
 * **Never throws.** Org seeding must not fail because a starter tag did not land, and the
 * backfill must not abort a 500-org run on one bad org — every failure logs and returns.
 *
 * Requires the `tag_ai_classify` CustomField (entity migration `074-tag-ai-classify`). When
 * it is missing this is a logged no-op rather than a partial seed: creating the five tags
 * without their eligibility flag would make them look seeded, so the next pass would skip
 * them forever and the org would silently have zero eligible labels.
 *
 * @param db - drizzle instance
 * @param organizationId - the org to seed
 * @param userId - the acting user (the seeding user, or the org's system user on the
 *   backfill path) — `UnifiedCrudHandler` stamps it as the creator
 */
export async function seedAiCategoryTags(
  db: Database,
  organizationId: string,
  userId: string
): Promise<AiCategoryTagSeedResult> {
  // Declared outside the try so a mid-run failure still reports what did land — the
  // difference between "nothing happened" and "three of six exist" decides whether a
  // re-run is enough.
  const created: string[] = []
  const skipped: string[] = []
  const adopted: string[] = []

  try {
    const [tagDef] = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, TAG_DEF)
        )
      )
      .limit(1)

    if (!tagDef) {
      logger.warn('Skipping AI category tag seed — organization has no tag entity', {
        organizationId,
      })
      return { created, skipped, adopted }
    }

    const [eligibilityField] = await db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, tagDef.id),
          eq(schema.CustomField.systemAttribute, 'tag_ai_classify')
        )
      )
      .limit(1)

    if (!eligibilityField) {
      logger.warn(
        'Skipping AI category tag seed — tag_ai_classify field missing (run entity migration 074 first)',
        { organizationId }
      )
      return { created, skipped, adopted }
    }

    const titles = [AI_CATEGORY_PARENT_TAG.title, ...AI_CATEGORY_STARTER_TAGS.map((t) => t.title)]
    const existingRows = await db
      .select({
        id: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, tagDef.id),
          isNull(schema.EntityInstance.archivedAt),
          inArray(schema.EntityInstance.displayName, titles)
        )
      )

    const existingByTitle = new Map<string, string>()
    for (const row of existingRows) {
      if (row.displayName && !existingByTitle.has(row.displayName)) {
        existingByTitle.set(row.displayName, row.id)
      }
    }

    // `is_system_tag` is `creatable: false` in the registry and its pre-hook drops any
    // unauthorized write, so the explicit `false` below needs the same bypass the legacy tag
    // seed uses. Scoped to this handler: it documents the privilege boundary, and writing the
    // flag explicitly (rather than leaning on the default) is what makes "these are ORDINARY
    // tags" a fact in the data rather than an omission.
    const handler = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
      bypassFieldGuards: new Set(['is_system_tag']),
    })
    // No active users to notify during a seed, and each invalidation costs seconds on Lambda
    // when Redis is slow.
    const seedOpts = { skipEvents: true }

    const existingParentId = existingByTitle.get(AI_CATEGORY_PARENT_TAG.title)

    let parentRecordId: RecordId
    if (existingParentId) {
      parentRecordId = toRecordId(tagDef.id, existingParentId)
      skipped.push(AI_CATEGORY_PARENT_TAG.title)
    } else {
      const parent = await handler.create(
        TAG_DEF,
        {
          title: AI_CATEGORY_PARENT_TAG.title,
          tag_description: AI_CATEGORY_PARENT_TAG.description,
          tag_emoji: AI_CATEGORY_PARENT_TAG.emoji,
          tag_color: AI_CATEGORY_PARENT_TAG.color,
          tag_scope: THREAD_SCOPE,
          // The container is not a label the classifier may apply.
          tag_ai_classify: false,
          is_system_tag: false,
        },
        seedOpts
      )
      parentRecordId = parent.recordId
      created.push(AI_CATEGORY_PARENT_TAG.title)
    }

    // Sequential, like the legacy tag seed: parallel creates racing the same parent's
    // inverse (`tag_children`) sync collide on sortKey.
    for (const tag of AI_CATEGORY_STARTER_TAGS) {
      const existingId = existingByTitle.get(tag.title)
      if (existingId) {
        const outcome = await adoptLegacySystemStarter(db, {
          organizationId,
          userId,
          tagDefId: tagDef.id,
          instanceId: existingId,
          seed: tag,
          parentRecordId,
        })
        if (outcome === 'adopted') adopted.push(tag.title)
        else skipped.push(tag.title)
        continue
      }

      await handler.create(
        TAG_DEF,
        {
          title: tag.title,
          tag_description: tag.description,
          tag_emoji: tag.emoji,
          tag_color: tag.color,
          tag_parent: parentRecordId,
          tag_scope: THREAD_SCOPE,
          tag_ai_classify: true,
          is_system_tag: false,
        },
        seedOpts
      )
      created.push(tag.title)
    }

    if (created.length > 0 || skipped.length > 0 || adopted.length > 0) {
      logger.info('AI category tags seeded', { organizationId, created, skipped, adopted })
    }

    return { created, skipped, adopted }
  } catch (error) {
    logger.error('AI category tag seed failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
      created,
      skipped,
      adopted,
    })
    return { created, skipped, adopted }
  }
}
