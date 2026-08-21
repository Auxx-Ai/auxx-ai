// packages/lib/src/seed/ai-category-tags.ts
//
// The starter mail categories (plans/mail-filter/06-mail-categories-rework-plan.md §2) and the
// one function that seeds them — called from `OrganizationSeeder.seedTags` for new orgs and
// from `scripts/backfill-ai-category-tags.ts` for existing ones, so both paths seed exactly
// the same rows.
//
// SIX RULES THIS FILE EXISTS TO KEEP:
//
//  1. **Ordinary tags, never system tags** (05 C4, 06 D5). `tag-system-guard.ts` rejects every
//     edit to a system tag's title/description/emoji/color/parent AND rejects its delete.
//     Under 05 C3 the `tag_description` IS the classifier's instruction for that label — the
//     tuning surface — so seeding these as system tags would freeze the one field the whole
//     feature depends on. `is_system_tag: false`, deliberately and explicitly.
//  2. **Undeletable via `tag_template_key`, not via `is_system_tag`** (06 D4). The template key
//     is a PROVENANCE MARKER, not a lock: title, emoji, colour, parent and above all the
//     description stay editable, while the delete hook refuses to remove a shipped category and
//     the UI can offer "reset to default". ⚠️ It is written ONLY through a `bypassFieldGuards`
//     set, exactly as `is_system_tag` is — a user who can set it can make any tag undeletable
//     (06 invariant 2).
//  3. **Descriptions are prompt text, not blurbs.** The model reads them verbatim as the
//     label's definition, so they are copied byte-for-byte from plan 06 §2.1–2.3 and carry the
//     precedence hints that keep the overlapping pairs decidable (Returns & Refunds vs Billing).
//  4. **No `Spam` category** (05 C6) and **no catch-all `Other`** (06 §2.4). `set-status: SPAM`
//     already exists, and `MAIL_CLASSIFY_NO_CATEGORY` already represents abstention — a
//     catch-all label would be reached for *instead of* abstaining.
//  5. **Seeding never enables classification.** These rows only make a label *available*.
//     Nothing is classified until an inbox is opted in, which is a separate switch.
//  6. **Never touch a USER'S tag.** A title the org already uses is skipped whole — no
//     re-parenting, no description overwrite, no flag flip. A user's taxonomy is theirs, and
//     re-running the seed must be a no-op.
//
//     ONE EXCEPTION: a pre-existing starter carrying `is_system_tag = true` is one WE seeded,
//     and it is frozen by `rejectIfSystemTag` — so the org could never tune the classifier
//     instruction that rule 1 exists to protect. `adoptLegacySystemStarter` converts those in
//     place. The discriminator is the FLAG, not the title: a user-created tag of the same name
//     is left entirely alone, because a title collision is not consent (06 invariant 5).
//
// WHAT THIS FILE DOES NOT DO: it never RENAMES anything. Adopting the legacy system tags
// `Orders` → `Order Status` and `Account Management` → `Account` is data migration `076`
// (06 §5.1 step 3), which owns the one-time reshape of an existing org's taxonomy. The seeder
// only matches on the titles it ships.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { seedSession, UnifiedCrudHandler } from '../resources/crud'
import { type RecordId, toRecordId } from '../resources/resource-id'

const logger = createScopedLogger('ai-category-tags')

/** The `EntityDefinition.entityType` tags live on. */
const TAG_DEF = 'tag'

/** Thread-scoped only (05 Q3): article tags exist for KB content, not for mail. */
const THREAD_SCOPE = 'thread'

/**
 * Which set a seeded category belongs to (06 D3).
 *
 * `core` is seeded for every org. The vertical packs are opt-in, because the eligible label
 * list IS the prompt (05 C2) and every extra label costs accuracy for orgs that never see that
 * intent — see 06 invariant 12.
 */
export type AiCategoryPack = 'core' | 'commerce' | 'partner'

/** One starter category, before it is written. */
export interface AiCategoryTagSeed {
  title: string
  /**
   * The classifier's instruction for this label — read verbatim into the prompt (05 C3).
   * Never empty: a bare title classifies measurably worse.
   */
  description: string
  emoji: string
  color: string
  /**
   * The shipped identity of this category, written to `tag_template_key` (06 §3.1). It is what
   * lets "reset to default" find the right default and what makes the row undeletable. Stable
   * forever — a rename changes the title, never this.
   */
  templateKey: string
  /** `core` for every org; anything else is opt-in (06 D3). */
  pack: AiCategoryPack
}

/**
 * The descriptions the FIVE pre-rework starters shipped with, keyed by their title.
 *
 * ⚠️ **Do not delete, do not "tidy", do not reformat.** Data migration `076` overwrites a
 * seeded category's description with the new §2.1 text **only when the current value is empty
 * or byte-identical to one of these** (06 §5.3, invariant 6). Anything else is the customer's
 * own tuning of the classifier — the single field this whole plan exists to make theirs — and
 * losing it is unrecoverable. Without these strings the migration cannot tell "still our
 * shipped default" from "they edited it", and its only remaining options are clobber-everything
 * or skip-everything.
 *
 * `Newsletter` and `Notification` are here even though they are no longer categories (06 D2):
 * the migration still has to recognise an unedited one to retire it cleanly.
 */
export const LEGACY_STARTER_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  Sales:
    'A prospective or existing customer with buying intent: pricing, quotes, plans, stock or availability, product fit, a demo, or expanding an existing order. Pre-purchase interest, not a problem with something already bought.',
  Support:
    'The sender needs help with something they already have: a fault, an error, a how-to question, a delivery or order-status chase, a return or a complaint. Something is broken, missing, or not understood.',
  Billing:
    'Anything about money owed or paid: invoices, charges, refunds, payment methods, subscription or plan fees, failed payments, dunning, receipts and tax documents.',
  Newsletter:
    'Bulk marketing or editorial mail broadcast to a list — product news, promotions, offers, digests, event invitations. Written for many recipients rather than for us, and needs no reply.',
  Notification:
    'Automated machine mail generated by a system rather than written by a person: service alerts, account and security notices, monitoring or build results, calendar and shipping updates, confirmations of an automated action. If it is about money owed or paid, prefer Billing; if it is bulk marketing, prefer Newsletter.',
})

/** The template key stamped on the container group (see `AI_CATEGORY_PARENT_TAG`). */
export const AI_CATEGORY_PARENT_TEMPLATE_KEY = 'category:mail-categories'

/**
 * The group the starters hang under, so they read as one set in the picker instead of
 * scattering through the org's taxonomy.
 *
 * An ordinary tag itself, and NOT eligible: "Mail Categories" is a container, and an eligible
 * container would be offered to the model as a label it could apply (06 invariant 17 — the
 * eligible set stays FLAT, and a parent is decoration to `buildTagQuery` anyway).
 *
 * It carries a template key so the container cannot be deleted out from under its children. Its
 * key is deliberately distinct from every category key, so anything enumerating shipped
 * *categories* can exclude it by identity rather than by title.
 */
export const AI_CATEGORY_PARENT_TAG: AiCategoryTagSeed = {
  title: 'Mail Categories',
  description:
    'Grouping for the categories the AI classifier may apply to inbound mail. Not applied to mail itself.',
  emoji: '📬',
  color: 'blue',
  templateKey: AI_CATEGORY_PARENT_TEMPLATE_KEY,
  pack: 'core',
}

/**
 * The core four — every org, every prompt (06 §2.1).
 *
 * Four, because Freshdesk ships four types and Salesforce's Case Reason is about six; nobody
 * mature ships thirteen. Each routes to a different team, which is the test a label has to pass.
 *
 * Each description is prompt text. Editing one retunes the classifier for that org, which is
 * the point: these are starting definitions, not fixed ones.
 */
export const AI_CATEGORY_CORE_TAGS: AiCategoryTagSeed[] = [
  {
    title: 'Sales',
    description:
      'A prospective or existing customer with buying intent: pricing, quotes, availability, product fit, a demo, or expanding an order. Pre-purchase interest, not a problem with something already bought.',
    emoji: '💼',
    color: 'pink',
    templateKey: 'category:sales',
    pack: 'core',
  },
  {
    title: 'Support',
    description:
      'The sender needs help with something they already have: a fault, an error, a how-to question, a return, or a complaint. Something is broken, missing, or not understood.',
    emoji: '🆘',
    color: 'red',
    templateKey: 'category:support',
    pack: 'core',
  },
  {
    title: 'Billing',
    description:
      'Anything about money owed or paid: invoices, charges, refunds, payment methods, subscription fees, failed payments, dunning, receipts and tax documents.',
    emoji: '💳',
    color: 'green',
    templateKey: 'category:billing',
    pack: 'core',
  },
  {
    title: 'Account',
    description:
      'Access and administration rather than money: sign-in and password problems, user or seat changes, permissions, plan or subscription changes, data export, closing an account.',
    emoji: '👤',
    color: 'purple',
    templateKey: 'category:account',
    pack: 'core',
  },
]

/**
 * Commerce pack — opt-in (06 §2.2). Justified by the corpus: order-related mail is the single
 * largest human category and WISMO ("where is my order") is the #1 intent in every commerce
 * helpdesk.
 *
 * ⚠️ `Returns & Refunds` overlaps `Billing` and `Support` BY DESIGN, and with one label per
 * message the model has to be told the precedence — the two descriptions carry it: money *for a
 * purchase being reversed* is Returns, money *owed or invoiced* is Billing. If measurement shows
 * the model splitting these inconsistently, MERGE the labels rather than adding tie-break prose;
 * tie-breakers in a prompt are the smell that killed the old `Notification` label.
 */
export const AI_CATEGORY_COMMERCE_TAGS: AiCategoryTagSeed[] = [
  {
    title: 'Order Status',
    description:
      'Asking where an existing order is, when it ships or arrives, or for tracking. The order exists and the sender wants its state, not a fault and not a change request.',
    emoji: '📦',
    color: 'amber',
    templateKey: 'category:order-status',
    pack: 'commerce',
  },
  {
    title: 'Returns & Refunds',
    description:
      'Wanting to send something back, cancel an order, or get money back for a completed purchase: returns, exchanges, cancellations, damaged or wrong items.',
    emoji: '↩️',
    color: 'orange',
    templateKey: 'category:returns-refunds',
    pack: 'commerce',
  },
]

/**
 * Partner pack — opt-in (06 §2.3). A dealer/installer/reseller enquiry is neither Sales (not an
 * end customer) nor Support (nothing is broken), and nothing in the previous vocabulary covered
 * it despite it being high-volume in the sample corpus.
 */
export const AI_CATEGORY_PARTNER_TAGS: AiCategoryTagSeed[] = [
  {
    title: 'Partners & Dealers',
    description:
      'A business wanting to sell, install, distribute or integrate with us: dealer and reseller applications, installer enquiries, affiliate and partnership proposals. A business relationship, not an end-customer purchase.',
    emoji: '🤝',
    color: 'teal',
    templateKey: 'category:partners-dealers',
    pack: 'partner',
  },
]

/**
 * Every shipped category, flat, in prompt order (06 invariant 17: the eligible set is FLAT — no
 * subcategories in v1). Core first so the four an org always has read as the primary vocabulary.
 *
 * ⚠️ **Seven eligible leaves in total.** 06 Q10 sets the revisit trigger at ~10, so one further
 * pack reaches it — at that point price two-stage classification against apply-ancestors instead
 * of adding an eighth label by reflex.
 */
export const AI_CATEGORY_STARTER_TAGS: AiCategoryTagSeed[] = [
  ...AI_CATEGORY_CORE_TAGS,
  ...AI_CATEGORY_COMMERCE_TAGS,
  ...AI_CATEGORY_PARTNER_TAGS,
]

/**
 * The categories to seed for a given pack selection: always core, plus whatever was asked for.
 *
 * @param packs - opt-in packs beyond core. Unknown or duplicated entries are harmless.
 */
export function aiCategoryTagsForPacks(packs: readonly AiCategoryPack[] = []): AiCategoryTagSeed[] {
  const wanted = new Set<AiCategoryPack>(['core', ...packs])
  return AI_CATEGORY_STARTER_TAGS.filter((tag) => wanted.has(tag.pack))
}

/** What one seed pass did, for the caller's log line. */
export interface AiCategoryTagSeedResult {
  /** Titles created by this pass. */
  created: string[]
  /** Titles the org already had that were left untouched (user-owned, or already adopted). */
  skipped: string[]
  /** Titles that existed as LEGACY SYSTEM tags and were converted in place. */
  adopted: string[]
}

/** Options for one seed pass. */
export interface SeedAiCategoryTagsOptions {
  /**
   * Opt-in packs beyond core (06 D3). Empty by default — 06 Q3's recommendation is that pack
   * selection is inferred by the CALLER (e.g. commerce where the org has a Shopify
   * integration), never assumed here.
   */
  packs?: readonly AiCategoryPack[]
}

/**
 * Convert one pre-existing **legacy system** starter tag into an ordinary, tunable one.
 *
 * ## Why this exists
 *
 * `seedTags` historically created `Billing`, `Sales` and `Support` as SYSTEM tags. System tags
 * are frozen by `rejectIfSystemTag` — `tag_description` included — and that description IS the
 * classifier's instruction for the label (05 C3). So without this, an org created before mail
 * classification would carry starters that can be flagged eligible but can NEVER be tuned, and
 * would classify as bare titles with no UI anywhere able to fix it.
 *
 * ## What it will and will not touch
 *
 * **Only tags carrying `is_system_tag = true`** — i.e. ones we seeded. A user's own tag that
 * happens to be called `Sales` is theirs: its description is left alone and it is not made
 * eligible. Title collision is not consent (06 invariant 5).
 *
 * ## Ordering is load-bearing
 *
 * The flag is cleared in its own write, BEFORE the description write (06 invariant 4).
 * `rejectIfSystemTag` reads the tag's CURRENT `is_system_tag` at hook time, so once the flag is
 * false the description write passes the guard normally. Doing both in one call would trip the
 * guard on the description.
 *
 * ⚠️ The second write carries a bypass for `tag_template_key` ONLY — that field is
 * `creatable: false` / `updatable: false` by design (06 invariant 2), so it cannot land without
 * one. `is_system_tag` is deliberately NOT in that set: re-granting it there would reopen the
 * hole the two-write split exists to close.
 *
 * ⚠️ Setting `tag_ai_classify = true` is also what stops entity migration `014` re-freezing
 * these by title on its next run (`014-backfill-system-tags.ts` → `excludeAiClassifyTags`).
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
    /** `CustomField.id` of `is_system_tag`, or undefined when the org has no such field. */
    systemFieldId: string | undefined
  }
): Promise<'adopted' | 'left-alone'> {
  const { organizationId, userId, tagDefId, instanceId, seed, parentRecordId, systemFieldId } = args

  if (!systemFieldId) return 'left-alone'

  const [flagRow] = await db
    .select({ valueBoolean: schema.FieldValue.valueBoolean })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, systemFieldId),
        eq(schema.FieldValue.entityId, instanceId)
      )
    )
    .limit(1)

  // Not one of ours — a user-created tag that happens to share the title. Hands off.
  if (flagRow?.valueBoolean !== true) return 'left-alone'

  const recordId = toRecordId(tagDefId, instanceId)
  // Both handlers run under a seed session: the silent lane suppresses events
  // exactly as the per-call `skipEvents: true` used to.
  const session = seedSession('ai category tag seeding')

  // 1. Unfreeze. Needs the same bypass the create path uses, because `is_system_tag` is
  //    `creatable: false` and `dropUnauthorizedSystemFlag` drops unauthorized writes.
  const unfreeze = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    bypassFieldGuards: new Set(['is_system_tag']),
    session,
  })
  await unfreeze.update(recordId, { is_system_tag: false })

  // 2. Now an ordinary tag, so `rejectIfSystemTag` lets the description through. The only
  //    bypass here is the one `tag_template_key` structurally requires.
  const handler = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    bypassFieldGuards: new Set(['tag_template_key']),
    session,
  })
  await handler.update(recordId, {
    tag_description: seed.description,
    tag_parent: parentRecordId,
    tag_scope: THREAD_SCOPE,
    tag_ai_classify: true,
    tag_template_key: seed.templateKey,
  })

  logger.info('Adopted legacy system tag as an AI category starter', {
    organizationId,
    title: seed.title,
    templateKey: seed.templateKey,
    instanceId,
  })
  return 'adopted'
}

/**
 * Seed the starter mail categories (plus their parent group) for one organization.
 *
 * Idempotent by tag title: an org that already has a tag called `Billing` keeps the one it has,
 * untouched, and no duplicate is written. A second pass creates nothing.
 *
 * **Never throws.** Org seeding must not fail because a starter tag did not land, and the
 * backfill must not abort a 500-org run on one bad org — every failure logs and returns.
 *
 * Requires two CustomFields: `tag_ai_classify` (entity migration `074-tag-ai-classify`) and
 * `tag_template_key` (entity migration `075-tag-template-key`). When either is missing this is
 * a logged no-op rather than a partial seed: creating the categories without their eligibility
 * flag or their template key would make them LOOK seeded, so the next pass would skip them
 * forever — leaving an org with zero eligible labels, or with deletable categories nothing can
 * reset.
 *
 * @param db - drizzle instance
 * @param organizationId - the org to seed
 * @param userId - the acting user (the seeding user, or the org's system user on the backfill
 *   path) — `UnifiedCrudHandler` stamps it as the creator
 * @param options - `packs` opts into the vertical packs; core is always seeded
 */
export async function seedAiCategoryTags(
  db: Database,
  organizationId: string,
  userId: string,
  options: SeedAiCategoryTagsOptions = {}
): Promise<AiCategoryTagSeedResult> {
  // Declared outside the try so a mid-run failure still reports what did land — the
  // difference between "nothing happened" and "three of six exist" decides whether a
  // re-run is enough.
  const created: string[] = []
  const skipped: string[] = []
  const adopted: string[] = []

  try {
    const seeds = aiCategoryTagsForPacks(options.packs)

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

    // One select for all three attributes this module writes through a guard: the two it
    // REQUIRES, plus `is_system_tag` so the adoption probe below costs one query instead of two.
    const fieldRows = await db
      .select({
        id: schema.CustomField.id,
        systemAttribute: schema.CustomField.systemAttribute,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, tagDef.id),
          inArray(schema.CustomField.systemAttribute, [
            'tag_ai_classify',
            'tag_template_key',
            'is_system_tag',
          ])
        )
      )

    const fieldIdByAttribute = new Map<string, string>()
    for (const row of fieldRows) {
      if (row.systemAttribute && !fieldIdByAttribute.has(row.systemAttribute)) {
        fieldIdByAttribute.set(row.systemAttribute, row.id)
      }
    }

    if (!fieldIdByAttribute.has('tag_ai_classify')) {
      logger.warn(
        'Skipping AI category tag seed: tag_ai_classify field missing (run entity migration 074 first)',
        { organizationId }
      )
      return { created, skipped, adopted }
    }

    if (!fieldIdByAttribute.has('tag_template_key')) {
      logger.warn(
        'Skipping AI category tag seed: tag_template_key field missing (run entity migration 075 first)',
        { organizationId }
      )
      return { created, skipped, adopted }
    }

    const titles = [AI_CATEGORY_PARENT_TAG.title, ...seeds.map((t) => t.title)]
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

    // `is_system_tag` and `tag_template_key` are both `creatable: false` in the registry and
    // their writes are dropped for unauthorized callers, so the explicit values below only land
    // with the bypass. Scoped to this handler: it documents the privilege boundary, and writing
    // `is_system_tag: false` explicitly (rather than leaning on the default) is what makes
    // "these are ORDINARY tags" a fact in the data rather than an omission.
    // The seed session's silent lane suppresses events — no active users to notify during
    // a seed, and each invalidation costs seconds on Lambda when Redis is slow.
    const handler = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
      bypassFieldGuards: new Set(['is_system_tag', 'tag_template_key']),
      session: seedSession('ai category tag seeding'),
    })

    const existingParentId = existingByTitle.get(AI_CATEGORY_PARENT_TAG.title)

    let parentRecordId: RecordId
    if (existingParentId) {
      parentRecordId = toRecordId(tagDef.id, existingParentId)
      skipped.push(AI_CATEGORY_PARENT_TAG.title)
    } else {
      const parent = await handler.create(TAG_DEF, {
        title: AI_CATEGORY_PARENT_TAG.title,
        tag_description: AI_CATEGORY_PARENT_TAG.description,
        tag_emoji: AI_CATEGORY_PARENT_TAG.emoji,
        tag_color: AI_CATEGORY_PARENT_TAG.color,
        tag_scope: THREAD_SCOPE,
        // The container is not a label the classifier may apply.
        tag_ai_classify: false,
        tag_template_key: AI_CATEGORY_PARENT_TAG.templateKey,
        is_system_tag: false,
      })
      parentRecordId = parent.recordId
      created.push(AI_CATEGORY_PARENT_TAG.title)
    }

    // Sequential, like the legacy tag seed: parallel creates racing the same parent's
    // inverse (`tag_children`) sync collide on sortKey.
    for (const tag of seeds) {
      const existingId = existingByTitle.get(tag.title)
      if (existingId) {
        const outcome = await adoptLegacySystemStarter(db, {
          organizationId,
          userId,
          tagDefId: tagDef.id,
          instanceId: existingId,
          seed: tag,
          parentRecordId,
          systemFieldId: fieldIdByAttribute.get('is_system_tag'),
        })
        if (outcome === 'adopted') adopted.push(tag.title)
        else skipped.push(tag.title)
        continue
      }

      await handler.create(TAG_DEF, {
        title: tag.title,
        tag_description: tag.description,
        tag_emoji: tag.emoji,
        tag_color: tag.color,
        tag_parent: parentRecordId,
        tag_scope: THREAD_SCOPE,
        tag_ai_classify: true,
        tag_template_key: tag.templateKey,
        is_system_tag: false,
      })
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
