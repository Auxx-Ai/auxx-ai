// server/api/routers/tag.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { getCachedCustomFields, getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError, UnprocessableEntityError } from '@auxx/lib/errors'
import { getEligibleClassificationTags } from '@auxx/lib/mail-classification/labels'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import {
  AI_CATEGORY_COMMERCE_TAGS,
  AI_CATEGORY_PARTNER_TAGS,
  type AiCategoryTagSeed,
  seedAiCategoryTags,
} from '@auxx/lib/seed/ai-category-tags'
import { TagService } from '@auxx/lib/tags'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

const scopeSchema = z.enum(['thread', 'article']).optional()

/** `EntityDefinition.entityType` tags live on. */
const TAG_DEF = 'tag'

/** `systemAttribute` of the provenance marker on a seeded category (plan 06 §3.1). */
const TAG_TEMPLATE_KEY_ATTRIBUTE = 'tag_template_key'

/**
 * The opt-in vertical packs (plan 06 D3). `core` is deliberately absent: the four core
 * categories are every org's baseline and there is no supported way to switch them off as a
 * group.
 */
export const OPTIONAL_CATEGORY_PACKS = ['commerce', 'partner'] as const
export type OptionalCategoryPack = (typeof OPTIONAL_CATEGORY_PACKS)[number]

/** The shipped definitions each pack contributes, keyed by pack (plan 06 §2.2–2.3). */
const PACK_SEEDS: Record<OptionalCategoryPack, AiCategoryTagSeed[]> = {
  commerce: AI_CATEGORY_COMMERCE_TAGS,
  partner: AI_CATEGORY_PARTNER_TAGS,
}

/** Human framing for the picker. The label text itself always comes from the seeds. */
const PACK_COPY: Record<OptionalCategoryPack, { title: string; summary: string }> = {
  commerce: {
    title: 'Commerce',
    summary:
      'For businesses that sell and ship physical goods. Separates "where is my order" and returns from general support.',
  },
  partner: {
    title: 'Partners & dealers',
    summary:
      'For businesses approached by resellers, installers, distributors or affiliates. These are enquiries that are neither an end-customer sale nor a support request.',
  },
}

/** One shipped category as the picker sees it. */
export interface CategoryPackLabel {
  /** Stable shipped identity — the thing a pack is resolved by, never the title. */
  templateKey: string
  /**
   * The live title when the tag exists, otherwise the shipped one. Titles are editable on a
   * seeded category (plan 06 D4), so the org's own wording is what gets shown.
   */
  title: string
  /** The shipped definition. This text is what the classifier reads (plan 05 C3). */
  description: string
  emoji: string
  /** The tag exists in this org and is not archived. */
  present: boolean
  /** The classifier may currently apply it — i.e. the pack is on for this label. */
  eligible: boolean
}

/**
 * One suggestion group, for display only.
 *
 * ⚠️ A group is NOT a stateful object. There is deliberately no `enabled` here
 * (plan 06 §7.2, reversed 2026-08-10): a group-level switch would be a second
 * control over `tag_ai_classify`, which the tag list already owns per tag, and
 * its "off" could never mean anything — turning a pack off never deleted its
 * categories, so they stayed in the list while the switch claimed otherwise.
 * Adding is one-way; from then on these are ordinary tags.
 */
export interface CategoryPackView {
  pack: OptionalCategoryPack
  title: string
  summary: string
  labels: CategoryPackLabel[]
}

/** What `categoryPacks` answers. */
export interface CategoryPacksView {
  packs: CategoryPackView[]
  /**
   * How many labels the classifier prompt would actually contain right now.
   *
   * Read from `getEligibleClassificationTags` — the exact function the classifier calls — so
   * this number cannot drift from the prompt. Plan 05 §12.5 gap 4 flagged that a second,
   * independently derived count already exists (`mailClassification.getInboxSettings` counts
   * via `TagService`); this surface deliberately does not add a third.
   */
  eligibleLabelCount: number
  /**
   * False until entity migration `075-tag-template-key` has materialized the field. Without it
   * a pack cannot be identified, seeded or turned off, so the UI renders read-only.
   */
  ready: boolean
}

/**
 * Resolve `tag` def id + the `tag_template_key` field id from the org cache.
 *
 * Both come from `@auxx/lib/cache` rather than fresh queries — `entityDefs` and the per-def
 * custom fields are cached keys, and re-querying them defeats the invalidation.
 */
async function loadTagDefContext(organizationId: string) {
  const tagDefId = await getCachedEntityDefId(organizationId, TAG_DEF)
  if (!tagDefId) return { tagDefId: undefined, templateKeyFieldId: undefined }

  const fields = await getCachedCustomFields(organizationId, tagDefId)
  const templateKeyFieldId = fields.find(
    (field) => field.systemAttribute === TAG_TEMPLATE_KEY_ATTRIBUTE
  )?.id

  return { tagDefId, templateKeyFieldId }
}

/**
 * Every pack's state in one read.
 *
 * ⚠️ Packs are resolved by `tag_template_key`, never by title (plan 06 invariant 5). A seeded
 * category can be renamed by the org and a user-created tag can share a shipped title; only the
 * template key says "this row is ours".
 *
 * NOTE: this query code would normally live in `packages/lib` per CLAUDE.md. It is here because
 * there is no pack module in lib yet; it should move to one beside `mail-classification/labels`
 * the moment there is a second caller.
 */
async function readCategoryPacks(db: Database, organizationId: string): Promise<CategoryPacksView> {
  const { tagDefId, templateKeyFieldId } = await loadTagDefContext(organizationId)

  // The classifier's own view of the label set — the count AND the membership test below.
  const eligibleLabels = await getEligibleClassificationTags(db, organizationId)
  const eligibleIds = new Set(eligibleLabels.map((label) => label.tagId))
  const titleById = new Map(eligibleLabels.map((label) => [label.tagId, label.title]))

  const seedByKey = new Map<string, AiCategoryTagSeed>()
  for (const pack of OPTIONAL_CATEGORY_PACKS) {
    for (const seed of PACK_SEEDS[pack]) seedByKey.set(seed.templateKey, seed)
  }

  const tagIdByKey = new Map<string, string>()
  if (tagDefId && templateKeyFieldId) {
    const rows = await db
      .select({
        entityId: schema.FieldValue.entityId,
        valueText: schema.FieldValue.valueText,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, templateKeyFieldId),
          inArray(schema.FieldValue.valueText, [...seedByKey.keys()])
        )
      )

    for (const row of rows) {
      if (row.entityId && row.valueText && !tagIdByKey.has(row.valueText)) {
        tagIdByKey.set(row.valueText, row.entityId)
      }
    }
  }

  // An archived category is not present for our purposes: it is not in the prompt, and the
  // seeder would create a fresh row rather than resurrect it.
  const liveTitleById = new Map<string, string>()
  const candidateIds = [...new Set(tagIdByKey.values())]
  if (tagDefId && candidateIds.length > 0) {
    const instances = await db
      .select({
        id: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, tagDefId),
          inArray(schema.EntityInstance.id, candidateIds),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
    for (const instance of instances) {
      liveTitleById.set(instance.id, instance.displayName ?? '')
    }
  }

  const packs = OPTIONAL_CATEGORY_PACKS.map((pack) => {
    const labels: CategoryPackLabel[] = PACK_SEEDS[pack].map((seed) => {
      const tagId = tagIdByKey.get(seed.templateKey)
      const present = Boolean(tagId && liveTitleById.has(tagId))
      const eligible = Boolean(tagId && eligibleIds.has(tagId))
      const liveTitle = tagId ? (titleById.get(tagId) ?? liveTitleById.get(tagId)) : undefined

      return {
        templateKey: seed.templateKey,
        title: liveTitle?.trim() ? liveTitle : seed.title,
        description: seed.description,
        emoji: seed.emoji,
        present,
        eligible,
      }
    })

    return { pack, ...PACK_COPY[pack], labels }
  })

  return {
    packs,
    eligibleLabelCount: eligibleLabels.length,
    ready: Boolean(tagDefId && templateKeyFieldId),
  }
}

export const tagRouter = createTRPCRouter({
  /**
   * Get all tags for an organization.
   * Returns tags with recordId for use in relationships.
   */
  getAll: protectedProcedure
    .input(z.object({ scope: scopeSchema }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      return tagService.getAllTags({ scope: input?.scope })
    }),

  /**
   * Search tags by name for autocomplete.
   * Returns tags matching the query with recordId and name for FilterRef.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string(), scope: scopeSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      return tagService.searchTags(input.query, undefined, { scope: input.scope })
    }),

  /**
   * Get tag hierarchy - builds a tree structure from flat tag list.
   */
  getHierarchy: protectedProcedure
    .input(z.object({ scope: scopeSchema }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      return tagService.getTagHierarchy({ scope: input?.scope })
    }),

  /**
   * The shipped mail categories an org could add, plus the current size of the classifier's
   * label set (plan 06 §7.2).
   *
   * A read, and a cheap one — no permission key. Which categories exist is already visible to
   * anyone who can see the tag list.
   */
  suggestedCategories: protectedProcedure.query(async ({ ctx }) => {
    return readCategoryPacks(ctx.db, ctx.session.organizationId)
  }),

  /**
   * Add one or more suggested categories to the org (plan 06 §7.2, revised 2026-08-10).
   *
   * ⚠️ **ONE-WAY, and that is the whole point of the revision.** This used to be
   * `setCategoryPack(pack, enabled)`, a persistent per-pack switch. It was removed because its
   * "off" could not describe anything true: turning a pack off never deleted its categories, so
   * they carried on sitting in the tag list — and a user could independently flip
   * `tag_ai_classify` from the tag dialog, leaving the pack switch and the tag disagreeing with
   * no defensible answer for which was right.
   *
   * So: adding creates the categories (idempotently) and marks them eligible. Everything after
   * that is ordinary tag management in the list, where `tag_ai_classify` has exactly one control.
   * To stop the classifier applying one, switch it off on the tag itself.
   *
   * Gated on `canEditEntity(tag)` — the same authority every other tag write on this page runs
   * through (`api.record.create` / `fieldValue.setBulk`). Deliberately not a coarse settings
   * key: a second authority disagreeing with the one the record path enforces is the defect the
   * tags page's own comment exists to avoid.
   */
  addSuggestedCategories: capabilityProcedure
    .input(
      z.object({
        /** Shipped identities to add. Resolved by `tag_template_key`, never by title. */
        templateKeys: z.array(z.string().min(1)).min(1).max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { tagDefId, templateKeyFieldId } = await loadTagDefContext(organizationId)

      if (!tagDefId) throw new NotFoundError('This organization has no tag records yet.')
      ctx.capabilities.assertEditEntity(tagDefId)

      if (!templateKeyFieldId) {
        throw new UnprocessableEntityError(
          'Mail categories are not set up for this organization yet. Run entity migration 075-tag-template-key first.'
        )
      }

      const requested = new Set(input.templateKeys)
      let view = await readCategoryPacks(ctx.db, organizationId)
      const known = view.packs.flatMap((group) => group.labels)
      if (!known.some((label) => requested.has(label.templateKey))) {
        throw new NotFoundError('None of those categories is a known suggestion.')
      }

      // Seed only the groups that actually own something missing. The seeder is idempotent BY
      // TITLE, so running it against a group whose categories the org has renamed would create a
      // second copy — checking presence by template key first keeps that to the narrow case
      // where a renamed category has also been archived.
      const groupsToSeed = view.packs
        .filter((group) =>
          group.labels.some((label) => requested.has(label.templateKey) && !label.present)
        )
        .map((group) => group.pack)

      if (groupsToSeed.length > 0) {
        await seedAiCategoryTags(ctx.db, organizationId, userId, { packs: groupsToSeed })
        view = await readCategoryPacks(ctx.db, organizationId)
      }

      const handler = new UnifiedCrudHandler(organizationId, userId, ctx.db, undefined, {
        capabilities: ctx.capabilities,
      })

      // Re-resolve ids from the template keys rather than trusting the pre-seed view.
      const idByKey = await resolveTagIdsByTemplateKey(ctx.db, organizationId, templateKeyFieldId, [
        ...requested,
      ])

      for (const label of view.packs.flatMap((group) => group.labels)) {
        if (!requested.has(label.templateKey)) continue
        // Already eligible is a no-op, not an error: adding twice must be safe.
        if (label.eligible) continue
        const tagId = idByKey.get(label.templateKey)
        if (!tagId) continue
        // `update` is (recordId, values, MODES, options) — options is the FOURTH arg.
        await handler.update(toRecordId(tagDefId, tagId), { tag_ai_classify: true })
      }

      return readCategoryPacks(ctx.db, organizationId)
    }),

  // NOTE: Tag create / update / delete endpoints have been removed.
  // The tag UI uses api.record.create, useSaveFieldValue (api.fieldValue.setBulk),
  // and api.record.delete instead. Tag-to-entity assignments use the RELATIONSHIP
  // field type via useSaveFieldValue with fieldType='RELATIONSHIP'.
})

/** `tag_template_key` → `EntityInstance.id` for the given keys. */
async function resolveTagIdsByTemplateKey(
  db: Database,
  organizationId: string,
  templateKeyFieldId: string,
  templateKeys: string[]
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, templateKeyFieldId),
        inArray(schema.FieldValue.valueText, templateKeys)
      )
    )

  const byKey = new Map<string, string>()
  for (const row of rows) {
    if (row.entityId && row.valueText && !byKey.has(row.valueText)) {
      byKey.set(row.valueText, row.entityId)
    }
  }
  return byKey
}
