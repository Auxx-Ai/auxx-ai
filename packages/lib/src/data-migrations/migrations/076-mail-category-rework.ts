// packages/lib/src/data-migrations/migrations/076-mail-category-rework.ts
//
// Retire the legacy system tags and adopt the new mail-category taxonomy
// (plans/mail-filter/06-mail-categories-rework-plan.md §5).
//
// THE FIVE TRAPS THIS FILE EXISTS TO AVOID — each one is a plan ⚠️:
//
//  1. **Never clobber an edited description** (§5.3, invariant 6 — "the
//     unrecoverable one"). A seeded category's description IS the classifier's
//     instruction, and re-wording it per business is the entire point of the
//     rework. So a description is overwritten ONLY when it is empty or
//     byte-identical to something we previously shipped. That is why
//     `LEGACY_STARTER_DESCRIPTIONS` exists in `seed/ai-category-tags.ts` — this
//     migration is its only consumer.
//  2. **Unfreeze in its own write, BEFORE the description write** (invariant 4).
//     `rejectIfSystemTag` reads the tag's CURRENT `is_system_tag` at hook time,
//     so a combined `{ is_system_tag: false, tag_description: … }` still trips
//     the guard on the description. `adoptLegacySystemStarter` already does this
//     correctly and is reused verbatim for the two renames.
//  3. **The discriminator is `is_system_tag = true`, never the title**
//     (invariant 5). A user-created tag called `Orders` is theirs; a title
//     collision is not consent.
//  4. **Ids are preserved** (invariant 3). Every legacy tag is adopted and
//     renamed in place, never deleted and recreated — filters, mined
//     suggestions and threads all reference these ids.
//  5. **This migration is REPLAYED, not ledger-guarded** if it is ever invoked
//     through `runEntityMigrationsForOrg` (05 §12.2 — `alreadyUpToDate` is a
//     report, not a guard). Every step is idempotent on its own terms: it reads
//     the current state and writes only the difference, never "has this run
//     before".
//
// WHAT THIS MIGRATION MUST NOT DO: re-classify anything (invariant 12). It
// changes the vocabulary underneath already-classified mail and leaves it
// labelled with the old categories; re-classification is a product feature
// (`07-mail-reclassification-plan.md`) and a migration may not spend money.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { UnifiedCrudHandler } from '../../resources/crud'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import {
  AI_CATEGORY_PARENT_TAG,
  AI_CATEGORY_PARENT_TEMPLATE_KEY,
  AI_CATEGORY_STARTER_TAGS,
  type AiCategoryPack,
  type AiCategoryTagSeed,
  aiCategoryTagsForPacks,
  LEGACY_STARTER_DESCRIPTIONS,
  seedAiCategoryTags,
} from '../../seed/ai-category-tags'
import { SystemUserService } from '../../users/system-user-service'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-076')

/** The `EntityDefinition.entityType` tags live on. */
const TAG_DEF = 'tag'

/** Thread-scoped only — article tags are KB content, never mail labels. */
const THREAD_SCOPE = 'thread'

/** Every tag write here is a reshape: no realtime fan-out, no notifications. */
const SEED_OPTS = { skipEvents: true } as const

// ═══════════════════════════════════════════════════════════════════════════
// THE TARGET STATE — what happens to each of the 13 legacy system tags (D6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Frozen snapshot of `014-backfill-system-tags.ts`'s canonical title list — the
 * 13 tags `OrganizationSeeder.seedTags` created as SYSTEM tags.
 *
 * Kept here so the partition below can be proven exhaustive in a test: every
 * one of these 13 is adopted, retired, preserved, collapsed, or already an
 * ordinary starter. A title that belongs to none of those buckets would be left
 * frozen forever with nothing pointing at it.
 */
export const LEGACY_SYSTEM_TAG_TITLES: readonly string[] = Object.freeze([
  'Topic Categorization',
  'Account Management',
  'Billing',
  'Customer Feedback',
  'Legal',
  'Sales',
  'Security',
  'Shipping',
  'Troubleshooting',
  'Support',
  'Urgent',
  'Orders',
  'VIP',
])

/** The legacy grouping node the taxonomy collapses into `Mail Categories` (D6). */
export const LEGACY_PARENT_TITLE = 'Topic Categorization'

/**
 * The legacy SYSTEM tags worth keeping, adopted in place and renamed (§5.1
 * step 3).
 *
 * The target is named by `templateKey`, not by title, so a later rename in the
 * taxonomy propagates here automatically instead of silently un-adopting.
 *
 * ⚠️ Matched on `is_system_tag = true` only. A user's own `Orders` tag is
 * theirs (invariant 5), and its id is preserved either way (invariant 3).
 */
export const LEGACY_SYSTEM_ADOPTIONS: readonly { from: string; templateKey: string }[] =
  Object.freeze([
    { from: 'Orders', templateKey: 'category:order-status' },
    { from: 'Account Management', templateKey: 'category:account' },
  ])

/**
 * Legacy system tags with no place in the taxonomy (§2.4): duplicates of a core
 * label, or too rare to earn a prompt slot.
 *
 * ⚠️ **Unflagged, never deleted** (§5.1 step 5). An org may have applied one by
 * hand and an ordinary, non-eligible tag costs nothing; deleting it would drop
 * real curation for a cosmetic tidy.
 */
export const RETIRED_SYSTEM_TAG_TITLES: readonly string[] = Object.freeze([
  'Customer Feedback',
  'Legal',
  'Security',
  'Shipping',
  'Troubleshooting',
])

/**
 * Left **completely** alone (§5.1 step 7): still system tags, still not
 * eligible.
 *
 * ⚠️ Priority and segment are not intents (invariant 8). Making either eligible
 * would let classification guard exit 6 suppress categorisation entirely for
 * any thread a filter marked VIP.
 */
export const PRESERVED_SYSTEM_TAG_TITLES: readonly string[] = Object.freeze(['Urgent', 'VIP'])

/**
 * The two starters retired as AI LABELS by D2 — both are answerable from
 * headers and `machineMailTier` for free, and they ship as seeded filters now
 * (`seed-suggested-filters.ts`).
 *
 * Their `tag_ai_classify` is cleared so they stop costing a prompt slot; the
 * tags themselves survive as ordinary tags for the same reason the retired
 * system tags do — mail already carries them.
 */
export const RETIRED_LABEL_TITLES: readonly string[] = Object.freeze(['Newsletter', 'Notification'])

/**
 * Every description this product has ever shipped for a mail category — the
 * five pre-rework starters, the current taxonomy, and the container's.
 *
 * ⚠️ This set is the whole never-clobber rule (§5.3). A stored description that
 * is a member is still OURS and may be overwritten; anything else is the
 * business's own tuning of the classifier and is unrecoverable if lost.
 * `LEGACY_STARTER_DESCRIPTIONS` is deliberately frozen at its source for
 * exactly this comparison.
 */
const SHIPPED_DESCRIPTIONS: ReadonlySet<string> = new Set<string>([
  ...Object.values(LEGACY_STARTER_DESCRIPTIONS),
  ...AI_CATEGORY_STARTER_TAGS.map((tag) => tag.description),
  AI_CATEGORY_PARENT_TAG.description,
])

/** Titles this product has ever seeded as a mail category, current or retired. */
const SEEDED_CATEGORY_TITLES: ReadonlySet<string> = new Set<string>([
  ...AI_CATEGORY_STARTER_TAGS.map((tag) => tag.title),
  ...Object.keys(LEGACY_STARTER_DESCRIPTIONS),
])

// ═══════════════════════════════════════════════════════════════════════════
// PURE CORE — the decisions, separated from the IO that feeds them
// ═══════════════════════════════════════════════════════════════════════════

/** One live tag instance, folded from its `FieldValue` rows. */
export interface TagCensusRow {
  id: string
  title: string
  isSystemTag: boolean
  templateKey: string | null
  description: string | null
  parentId: string | null
  aiClassify: boolean
}

/** What {@link planDescriptionWrite} decided, and why. */
export type DescriptionVerdict = 'write' | 'unchanged' | 'user-edited'

/**
 * The never-clobber rule (§5.3, invariant 6).
 *
 * ⚠️ Overwrite ONLY when the stored value is empty or **byte-identical** to
 * something we shipped. No trimming, no normalising, no case folding on the
 * comparison itself: a loosened match is how real customer tuning gets
 * destroyed, and the description is the one field this whole plan exists to
 * make theirs.
 *
 * `unchanged` (already the target) is reported separately from `write` so a
 * replay writes nothing at all rather than re-writing the same string.
 */
export function planDescriptionWrite(
  current: string | null | undefined,
  target: string
): DescriptionVerdict {
  const value = current ?? ''
  if (value === target) return 'unchanged'
  // An empty description is not an edit — it is a category with no instruction,
  // which classifies measurably worse than one with a definition.
  if (value.trim().length === 0) return 'write'
  return SHIPPED_DESCRIPTIONS.has(value) ? 'write' : 'user-edited'
}

/**
 * Pack inference for an org that never chose (§5.4, Q3's recommendation):
 * **commerce where the org has a Shopify integration, default off otherwise.**
 *
 * The partner pack is never inferred — nothing in the data distinguishes a
 * dealer network from a direct-to-consumer store, and every extra label is a
 * silent accuracy tax on every classification (invariant 10).
 */
export function inferAiCategoryPacks(input: { hasShopify: boolean }): AiCategoryPack[] {
  return input.hasShopify ? ['commerce'] : []
}

/**
 * Find the org's `Mail Categories` container, if it has one WE seeded.
 *
 * Three arms, strongest first — the title alone is never enough (invariant 5),
 * because stamping a user's own group with a template key would make it
 * permanently undeletable:
 *
 *  1. it already carries the container's template key (a replay, or a new org);
 *  2. its description is byte-identical to the shipped container description;
 *  3. it parents at least one tag whose title is a category we have shipped.
 *
 * Returns `null` when nothing proves ownership. The seeder then skips the title
 * (it matches by title) and the container simply stays unstamped — the safe
 * failure, and one a human can resolve.
 */
export function findCategoryContainer(census: readonly TagCensusRow[]): TagCensusRow | null {
  const byKey = census.find((row) => row.templateKey === AI_CATEGORY_PARENT_TEMPLATE_KEY)
  if (byKey) return byKey

  for (const row of census) {
    if (row.title !== AI_CATEGORY_PARENT_TAG.title || row.isSystemTag) continue
    if (row.description === AI_CATEGORY_PARENT_TAG.description) return row
    if (census.some((c) => c.parentId === row.id && SEEDED_CATEGORY_TITLES.has(c.title))) return row
  }
  return null
}

/**
 * Is this ordinary tag one of OUR seeded categories, rather than a user's tag
 * that happens to share a title (invariant 5)?
 *
 * A SYSTEM tag is never "ours" in this sense — those go down the adopt path
 * (§5.1 step 3), which unfreezes first and is the only path allowed to write a
 * frozen tag.
 */
export function isSeededCategory(row: TagCensusRow, containerId: string | null): boolean {
  if (row.isSystemTag) return false
  if (row.templateKey !== null && row.templateKey.length > 0) return true
  if (containerId !== null && row.parentId === containerId) return true
  return row.description !== null && SHIPPED_DESCRIPTIONS.has(row.description)
}

/**
 * The values one existing seeded category still needs, or `null` when settled.
 *
 * A type ALIAS rather than an interface on purpose: only aliases get TypeScript's
 * implicit index signature, which is what lets the patch be handed straight to
 * `update(recordId, values: Record<string, unknown>)` without a cast.
 */
export type StarterPatch = {
  tag_template_key?: string
  tag_description?: string
}

/**
 * Step 2 (§5.1): stamp `tag_template_key` and adopt the new §2.1 description on
 * a starter the org already has as an ORDINARY tag.
 *
 * ⚠️ `tag_ai_classify` is deliberately absent. Step 2 says "stamp
 * `tag_template_key` and overwrite the description" and nothing else — an org
 * that switched a category OFF made a routing decision, and silently switching
 * it back on would be this migration re-enabling inference nobody asked for.
 *
 * Returns `null` when there is nothing to write, so a replay makes no call at
 * all.
 */
export function planStarterPatch(row: TagCensusRow, seed: AiCategoryTagSeed): StarterPatch | null {
  const patch: StarterPatch = {}
  if (row.templateKey !== seed.templateKey) patch.tag_template_key = seed.templateKey
  if (planDescriptionWrite(row.description, seed.description) === 'write') {
    patch.tag_description = seed.description
  }
  return Object.keys(patch).length > 0 ? patch : null
}

// ═══════════════════════════════════════════════════════════════════════════
// IO
// ═══════════════════════════════════════════════════════════════════════════

/** Field ids for every `systemAttribute` this migration reads or writes. */
type TagFieldIds = Map<string, string>

/** Per-org outcome, for the run log. */
export interface OrgReport {
  organizationId: string
  skipped?: string
  packs: AiCategoryPack[]
  stamped: string[]
  adopted: string[]
  created: string[]
  unflagged: string[]
  labelsRetired: string[]
  reparented: string[]
  legacyParentDeleted: boolean
  userEdits: string[]
}

function emptyReport(organizationId: string): OrgReport {
  return {
    organizationId,
    packs: [],
    stamped: [],
    adopted: [],
    created: [],
    unflagged: [],
    labelsRetired: [],
    reparented: [],
    legacyParentDeleted: false,
    userEdits: [],
  }
}

/** The `tag` EntityDefinition id for this org, or `null` when it has none. */
async function loadTagDefId(db: Database, organizationId: string): Promise<string | null> {
  const [def] = await db
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, TAG_DEF)
      )
    )
    .limit(1)
  return def?.id ?? null
}

/** `systemAttribute` → `CustomField.id` for the tag def, in one query. */
async function loadTagFieldIds(
  db: Database,
  organizationId: string,
  tagDefId: string
): Promise<TagFieldIds> {
  const rows = await db
    .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, tagDefId)
      )
    )

  const map: TagFieldIds = new Map()
  for (const row of rows) {
    if (row.systemAttribute && !map.has(row.systemAttribute)) map.set(row.systemAttribute, row.id)
  }
  return map
}

/**
 * Fold every live tag instance and its `FieldValue` rows into one census.
 *
 * Reads raw, deliberately (project convention for data migrations): the
 * composed record read applies lens gates and `_access` folding that a reshape
 * has no use for, and the `Tag` pgTable is legacy and must not be read at all.
 */
async function loadTagCensus(
  db: Database,
  organizationId: string,
  tagDefId: string,
  fieldIds: TagFieldIds
): Promise<TagCensusRow[]> {
  const instances = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, tagDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (instances.length === 0) return []

  // `fieldId` already restricts this to the tag def's rows, so no instance-id
  // list is needed — and the list would be unbounded on a large org anyway.
  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueBoolean: schema.FieldValue.valueBoolean,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityDefinitionId, tagDefId)
      )
    )

  const titleId = fieldIds.get('title')
  const descriptionId = fieldIds.get('tag_description')
  const systemId = fieldIds.get('is_system_tag')
  const templateId = fieldIds.get('tag_template_key')
  const classifyId = fieldIds.get('tag_ai_classify')
  const parentId = fieldIds.get('tag_parent')

  const rows = new Map<string, TagCensusRow>(
    instances.map((instance) => [
      instance.id,
      {
        id: instance.id,
        title: instance.displayName ?? '',
        isSystemTag: false,
        templateKey: null,
        description: null,
        parentId: null,
        aiClassify: false,
      },
    ])
  )

  for (const value of values) {
    const row = value.entityId ? rows.get(value.entityId) : undefined
    if (!row) continue
    if (value.fieldId === titleId && value.valueText) row.title = value.valueText
    else if (value.fieldId === descriptionId) row.description = value.valueText ?? null
    else if (value.fieldId === systemId) row.isSystemTag = value.valueBoolean === true
    else if (value.fieldId === templateId) row.templateKey = value.valueText ?? null
    else if (value.fieldId === classifyId) row.aiClassify = value.valueBoolean === true
    else if (value.fieldId === parentId) row.parentId = value.relatedEntityId ?? null
  }

  return [...rows.values()]
}

/**
 * Does this org sell? (§5.4 / Q3.)
 *
 * Two shapes count, because Shopify arrived twice: the `Integration` row (the
 * original channel/provider model — soft-deleted on disconnect, so
 * `deletedAt IS NULL` is mandatory) and an installed marketplace app. Either is
 * enough; neither is required.
 */
async function hasShopifyIntegration(db: Database, organizationId: string): Promise<boolean> {
  const [integration] = await db
    .select({ id: schema.Integration.id })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, 'shopify'),
        isNull(schema.Integration.deletedAt)
      )
    )
    .limit(1)
  if (integration) return true

  const [installation] = await db
    .select({ id: schema.AppInstallation.id })
    .from(schema.AppInstallation)
    .innerJoin(schema.App, eq(schema.App.id, schema.AppInstallation.appId))
    .where(
      and(
        eq(schema.AppInstallation.organizationId, organizationId),
        eq(schema.App.slug, 'shopify'),
        isNull(schema.AppInstallation.uninstalledAt)
      )
    )
    .limit(1)
  return Boolean(installation)
}

/**
 * The handler that may stamp `tag_template_key`.
 *
 * ⚠️ Scoped to that ONE attribute. `is_system_tag` is never in this set: the
 * unfreeze below is a separate handler with a separate bypass precisely so a
 * description write can never ride along with the flag clear (invariant 4).
 */
function templateKeyHandler(db: Database, organizationId: string, userId: string) {
  return new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    bypassFieldGuards: new Set(['tag_template_key']),
  })
}

/** The handler that may clear `is_system_tag` — and nothing else. */
function unfreezeHandler(db: Database, organizationId: string, userId: string) {
  return new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    bypassFieldGuards: new Set(['is_system_tag']),
  })
}

/**
 * STEP 2 (§5.1) — the starters the org already has as ordinary tags.
 *
 * Adds the provenance marker and brings the description up to the §2 text when
 * (and only when) the business has not written its own. The container is
 * stamped the same way, so it cannot be deleted out from under its children.
 */
async function stampSeededCategories(
  db: Database,
  organizationId: string,
  userId: string,
  tagDefId: string,
  census: readonly TagCensusRow[],
  container: TagCensusRow | null,
  seeds: readonly AiCategoryTagSeed[],
  report: OrgReport
): Promise<void> {
  const handler = templateKeyHandler(db, organizationId, userId)
  const byTitle = new Map<string, TagCensusRow>()
  for (const row of census) if (!byTitle.has(row.title)) byTitle.set(row.title, row)

  const targets: { row: TagCensusRow; seed: AiCategoryTagSeed }[] = []
  if (container) targets.push({ row: container, seed: AI_CATEGORY_PARENT_TAG })
  for (const seed of seeds) {
    const row = byTitle.get(seed.title)
    if (!row) continue
    if (!isSeededCategory(row, container?.id ?? null)) {
      // A user's own tag of the same name, or a system tag heading for the
      // adopt path. Either way: not ours to stamp.
      logger.info('Left a same-named tag alone — ownership unproven', {
        organizationId,
        title: seed.title,
        isSystemTag: row.isSystemTag,
      })
      continue
    }
    targets.push({ row, seed })
  }

  for (const { row, seed } of targets) {
    if (planDescriptionWrite(row.description, seed.description) === 'user-edited') {
      report.userEdits.push(seed.title)
      logger.info('Kept a tuned category description — divergence is the business’s own', {
        organizationId,
        title: seed.title,
      })
    }
    const patch = planStarterPatch(row, seed)
    if (!patch) continue
    await handler.update(toRecordId(tagDefId, row.id), patch, undefined, SEED_OPTS)
    report.stamped.push(seed.title)
  }
}

/**
 * STEP 3 (§5.1) — adopt a legacy SYSTEM tag in place and rename it.
 *
 * ⚠️ Two writes, in this order (invariant 4). `rejectIfSystemTag` reads the
 * tag's CURRENT flag at hook time, so the flag clear must land first and alone;
 * a combined write is rejected on `title`, `tag_description` and `tag_parent`
 * all three. This is `adoptLegacySystemStarter`'s proven sequence with the
 * rename added.
 *
 * ⚠️ The id is preserved — no delete, no recreate (invariant 3).
 */
async function adoptAndRename(
  db: Database,
  organizationId: string,
  userId: string,
  tagDefId: string,
  row: TagCensusRow,
  seed: AiCategoryTagSeed,
  parentRecordId: RecordId | null
): Promise<void> {
  const recordId = toRecordId(tagDefId, row.id)

  // 1. Unfreeze, alone.
  await unfreezeHandler(db, organizationId, userId).update(
    recordId,
    { is_system_tag: false },
    undefined,
    SEED_OPTS
  )

  // 2. Now an ordinary tag, so the guard lets the rest through. `tag_ai_classify`
  //    is also what stops entity migration `014` re-freezing this tag by title on
  //    its next replay (`excludeAiClassifyTags`).
  const values: Record<string, unknown> = {
    title: seed.title,
    tag_scope: THREAD_SCOPE,
    tag_ai_classify: true,
    tag_template_key: seed.templateKey,
  }
  if (planDescriptionWrite(row.description, seed.description) !== 'user-edited') {
    values.tag_description = seed.description
  }
  // Absent container: step 6 re-parents once the seeder has created it.
  if (parentRecordId) values.tag_parent = parentRecordId

  await templateKeyHandler(db, organizationId, userId).update(
    recordId,
    values,
    undefined,
    SEED_OPTS
  )
}

/** STEP 5 (§5.1) — clear `is_system_tag`, and nothing else. Never delete. */
async function unflagRetiredSystemTags(
  db: Database,
  organizationId: string,
  userId: string,
  tagDefId: string,
  census: readonly TagCensusRow[],
  report: OrgReport
): Promise<void> {
  const handler = unfreezeHandler(db, organizationId, userId)
  for (const row of census) {
    if (!row.isSystemTag) continue
    if (!RETIRED_SYSTEM_TAG_TITLES.includes(row.title)) continue
    await handler.update(
      toRecordId(tagDefId, row.id),
      { is_system_tag: false },
      undefined,
      SEED_OPTS
    )
    report.unflagged.push(row.title)
  }
}

/**
 * D2 — `Newsletter` and `Notification` stop being labels.
 *
 * Both are answerable from `List-Id` / `machineMailTier` for free, and paying a
 * model to read a header is the anti-pattern 05 §3.1.1 was written against.
 * They ship as seeded filters now. Only the eligibility flag is cleared: the
 * tag itself survives, because mail already carries it.
 */
async function retireLabels(
  db: Database,
  organizationId: string,
  userId: string,
  tagDefId: string,
  census: readonly TagCensusRow[],
  containerId: string | null,
  report: OrgReport
): Promise<void> {
  // No bypass: `tag_ai_classify` is an ordinary updatable field, and it is
  // deliberately NOT guarded by `rejectIfSystemTag` either.
  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  for (const row of census) {
    if (!RETIRED_LABEL_TITLES.includes(row.title)) continue
    if (!row.aiClassify) continue
    if (!isSeededCategory(row, containerId)) continue
    await handler.update(
      toRecordId(tagDefId, row.id),
      { tag_ai_classify: false },
      undefined,
      SEED_OPTS
    )
    report.labelsRetired.push(row.title)
  }
}

/**
 * STEP 6 (§5.1) — collapse the parents.
 *
 * Re-parents every template-keyed category under `Mail Categories` (the ones
 * adopted before the container existed), then deletes `Topic Categorization`
 * **only if it has no remaining children**.
 *
 * ⚠️ The retired tags of step 5 are NOT moved under `Mail Categories`. They are
 * not categories — putting them in the container would advertise them as labels
 * in the picker. The consequence is that an org still carrying any of them
 * keeps `Topic Categorization` as their group, which the conditional delete
 * already allows for.
 */
async function collapseParents(
  db: Database,
  organizationId: string,
  userId: string,
  tagDefId: string,
  census: readonly TagCensusRow[],
  report: OrgReport
): Promise<void> {
  const container = findCategoryContainer(census)
  /** Ids moved in THIS pass — the census still shows their old parent. */
  const movedIds = new Set<string>()

  if (container) {
    const handler = templateKeyHandler(db, organizationId, userId)
    const parentRecordId = toRecordId(tagDefId, container.id)
    for (const row of census) {
      if (row.id === container.id) continue
      if (!row.templateKey || row.templateKey === AI_CATEGORY_PARENT_TEMPLATE_KEY) continue
      if (row.parentId === container.id) continue
      await handler.update(
        toRecordId(tagDefId, row.id),
        { tag_parent: parentRecordId },
        undefined,
        SEED_OPTS
      )
      movedIds.add(row.id)
      report.reparented.push(row.title)
    }
  }

  const legacyParent = census.find((row) => row.title === LEGACY_PARENT_TITLE && row.isSystemTag)
  if (!legacyParent) return

  // The census predates the re-parents above, so `movedIds` — ids, not titles,
  // because two tags may share a name — is what keeps the count honest.
  const children = census.filter((row) => row.parentId === legacyParent.id && !movedIds.has(row.id))
  if (children.length > 0) {
    logger.info('Kept Topic Categorization — it still has children', {
      organizationId,
      children: children.map((c) => c.title),
    })
    return
  }

  // `rejectDeleteIfSystemTag` refuses a system tag's delete, so the flag has to
  // be cleared first — its own write again, for the same reason as invariant 4.
  const recordId = toRecordId(tagDefId, legacyParent.id)
  await unfreezeHandler(db, organizationId, userId).update(
    recordId,
    { is_system_tag: false },
    undefined,
    SEED_OPTS
  )
  await new UnifiedCrudHandler(organizationId, userId, db).delete(recordId, SEED_OPTS)
  report.legacyParentDeleted = true
}

/**
 * Reshape one organization's tag taxonomy. The seven steps of §5.1, in order.
 *
 * Throws on failure — the caller records which orgs failed and re-raises, so
 * the ledger never marks a partial run as applied.
 */
export async function migrateOrganizationTaxonomy(
  db: Database,
  organizationId: string
): Promise<OrgReport> {
  const report = emptyReport(organizationId)

  const tagDefId = await loadTagDefId(db, organizationId)
  if (!tagDefId) {
    report.skipped = 'no-tag-entity'
    logger.warn('Skipping mail-category rework — organization has no tag entity', {
      organizationId,
    })
    return report
  }

  // ── Step 1: the prerequisites ──────────────────────────────────────────
  // The registry field must be MATERIALIZED, not merely declared: `FieldValue.
  // fieldId` is a real FK, and the write path silently ignores an attribute with
  // no CustomField row. Half-migrating would leave categories that LOOK seeded —
  // deletable, unresettable, and invisible to a re-run.
  const fieldIds = await loadTagFieldIds(db, organizationId, tagDefId)
  if (!fieldIds.has('tag_template_key')) {
    report.skipped = 'tag_template_key-missing'
    logger.warn(
      'Skipping mail-category rework: tag_template_key field missing (run entity migration 075 first)',
      { organizationId }
    )
    return report
  }
  if (!fieldIds.has('tag_ai_classify')) {
    report.skipped = 'tag_ai_classify-missing'
    logger.warn(
      'Skipping mail-category rework: tag_ai_classify field missing (run entity migration 074 first)',
      { organizationId }
    )
    return report
  }
  if (!fieldIds.has('is_system_tag')) {
    // Without the flag nothing can be PROVEN ours, and "unprovable" must read as
    // the user's — never as consent (invariant 5). Adoption and retirement both
    // become no-ops; creating the missing categories is still safe.
    logger.warn('is_system_tag field missing — no legacy tag will be adopted or retired', {
      organizationId,
    })
  }

  // The create/update path resolves fields from the org cache, so a `075` that
  // ran in this same pass (or another process) has to be visible here or every
  // `tag_template_key` write is silently dropped.
  await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])

  const userId = await SystemUserService.getSystemUserForActions(organizationId)
  const census = await loadTagCensus(db, organizationId, tagDefId, fieldIds)
  const container = findCategoryContainer(census)

  const packs = inferAiCategoryPacks({
    hasShopify: await hasShopifyIntegration(db, organizationId),
  })
  report.packs = packs
  const seeds = aiCategoryTagsForPacks(packs)

  // ── Step 2: adopt the ordinary starters the org already has ────────────
  await stampSeededCategories(
    db,
    organizationId,
    userId,
    tagDefId,
    census,
    container,
    seeds,
    report
  )

  // ── Step 3: adopt + rename the legacy system tags worth keeping ────────
  const parentRecordId = container ? toRecordId(tagDefId, container.id) : null
  for (const adoption of LEGACY_SYSTEM_ADOPTIONS) {
    const seed = AI_CATEGORY_STARTER_TAGS.find((tag) => tag.templateKey === adoption.templateKey)
    if (!seed) continue
    // ⚠️ The flag, never the title (invariant 5).
    const row = census.find((r) => r.title === adoption.from && r.isSystemTag)
    if (!row) continue
    // Renaming onto a title the org already uses would give it two tags with one
    // name — worse than one badly-named tag, and unrecoverable in the picker.
    if (census.some((r) => r.title === seed.title && r.id !== row.id)) {
      logger.warn('Skipped a legacy adoption — the target title is already taken', {
        organizationId,
        from: adoption.from,
        to: seed.title,
      })
      continue
    }
    await adoptAndRename(db, organizationId, userId, tagDefId, row, seed, parentRecordId)
    report.adopted.push(`${adoption.from} → ${seed.title}`)
    // Keep the in-memory census honest for the steps that follow.
    row.title = seed.title
    row.isSystemTag = false
    row.templateKey = seed.templateKey
    row.aiClassify = true
    if (container) row.parentId = container.id
  }

  // ── Step 4: create whatever is still missing ───────────────────────────
  // Delegated to the seeder so a migrated org and a freshly-seeded one are
  // byte-identical, including the container and its template key.
  const seeded = await seedAiCategoryTags(db, organizationId, userId, { packs })
  report.created = seeded.created
  report.adopted.push(...seeded.adopted)

  // ── Steps 5 + D2: retire the rest ──────────────────────────────────────
  if (fieldIds.has('is_system_tag')) {
    await unflagRetiredSystemTags(db, organizationId, userId, tagDefId, census, report)
  }
  await retireLabels(db, organizationId, userId, tagDefId, census, container?.id ?? null, report)

  // ── Step 6: collapse the parents ───────────────────────────────────────
  // Re-read: step 4 may have created the container, and step 3's renames are
  // only reflected in the local census.
  const after = await loadTagCensus(db, organizationId, tagDefId, fieldIds)
  await collapseParents(db, organizationId, userId, tagDefId, after, report)

  // ── Step 7: `Urgent` and `VIP` are untouched, by never being named. ─────

  logger.info('Mail-category rework applied', { ...report })
  return report
}

/**
 * Retire the 13 legacy system tags and adopt the new mail-category taxonomy for
 * every organization (plan 06 §5).
 *
 * **What it does, per org:** stamps the provenance marker on the starters the
 * org already has, adopts `Orders` → `Order Status` and `Account Management` →
 * `Account` in place (ids preserved), creates whatever the org still lacks,
 * clears `is_system_tag` on the five retired topics, drops `Newsletter` and
 * `Notification` as AI labels, collapses `Topic Categorization` into
 * `Mail Categories` when it is empty, and leaves `Urgent`/`VIP` exactly as they
 * were.
 *
 * **What it never does:** re-classify (invariant 12), delete a tag a user might
 * have applied (§5.1 step 5), or overwrite a description the business has tuned
 * (§5.3 — the unrecoverable one).
 *
 * **Idempotent by state, not by ledger** (05 §12.2): every step reads the
 * current data and writes only the difference, so a replay through
 * `runEntityMigrationsForOrg` — where `alreadyUpToDate` is a report rather than
 * a guard — is a no-op rather than a second reshape.
 *
 * One org's failure does not stop the others: each is caught and logged, and
 * the run re-raises at the end so the ledger records the failure honestly and
 * the next pass repairs.
 */
export const migration076MailCategoryRework: DataMigrationDef = {
  id: '076-mail-category-rework',
  description:
    'Retire the legacy system tags and adopt the mail-category taxonomy (adopt in place, never clobber a tuned description)',
  async run(db: Database): Promise<void> {
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    const failures: { organizationId: string; error: string }[] = []

    for (const org of orgs) {
      try {
        await migrateOrganizationTaxonomy(db, org.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ organizationId: org.id, error: message })
        logger.error('Mail-category rework failed for one organization', {
          organizationId: org.id,
          error: message,
        })
      }
    }

    logger.info('Mail-category rework complete', {
      organizations: orgs.length,
      failed: failures.length,
    })

    if (failures.length > 0) {
      throw new Error(
        `Mail-category rework failed for ${failures.length} organization(s): ` +
          failures.map((f) => `${f.organizationId} (${f.error})`).join('; ')
      )
    }
  },
}
