// @auxx/lib/kb/learned/ensure-learned-kb.ts
// Lazy provisioning for the per-org "learned" knowledge base (AI memory).
// One KB per org (kind='learned', INTERNAL), a managed embedding dataset, and
// a fixed skeleton of published category articles the extractor files under.
// See plans/memory/learned-kb-plan.md.

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { createArticle } from '../articles/create-article'
import { publishArticle } from '../articles/publish-article'
import { resolveDb } from '../internal/context'
import { kbLogger as logger } from '../internal/errors'
import { createKnowledgeBase, ensureManagedDataset } from '../knowledge-base/create-knowledge-base'
import type { KBContext } from '../types'

type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect

/**
 * Deterministic slug for the one-per-org learned KB. The org-scoped unique
 * index on (organizationId, slug) makes concurrent provisioning safe: the
 * loser's insert fails and it re-reads the winner's row.
 */
export const LEARNED_KB_SLUG = '__learned'
export const LEARNED_KB_NAME = 'AI Memory'

/**
 * Fixed top-level skeleton. Category articles are identified by a stable
 * `sourceExternalId` key (`__learned:<key>`), never by title — humans may
 * rename them. Descriptions feed the injected Knowledge Catalog.
 */
export const LEARNED_CATEGORIES = {
  policies: {
    title: 'Policies',
    description: 'Org policies, product facts, and how we answer common questions.',
  },
  companies: {
    title: 'Companies',
    description: 'Durable facts learned about specific companies — one article per company.',
  },
  contacts: {
    title: 'Contacts',
    description: 'Durable facts learned about specific contacts — one article per contact.',
  },
} as const

export type LearnedCategoryKey = keyof typeof LEARNED_CATEGORIES

export const LEARNED_CATEGORY_KEYS = Object.keys(LEARNED_CATEGORIES) as LearnedCategoryKey[]

const categoryExternalId = (key: LearnedCategoryKey) => `__learned:${key}`

export interface LearnedKb {
  kb: KnowledgeBase
  /** Category-key → article id, for filing new articles under the skeleton. */
  categoryIds: Record<LearnedCategoryKey, string>
}

/**
 * Ensure the org's learned KB exists and return it with its skeleton category
 * ids. Idempotent and self-healing: re-provisions a missing managed dataset
 * and recreates deleted skeleton categories on every call.
 */
export async function ensureLearnedKb(ctx: KBContext): Promise<LearnedKb> {
  const db = resolveDb(ctx)
  let kb = await findLearnedKb(db, ctx.organizationId)
  if (!kb) kb = await provisionLearnedKb(ctx)
  await ensureManagedDataset(ctx, kb, kb.createdById)
  const categoryIds = await ensureSkeletonCategories(ctx, kb)
  return { kb, categoryIds }
}

async function findLearnedKb(db: Database, organizationId: string): Promise<KnowledgeBase | null> {
  const kb = await db.query.KnowledgeBase.findFirst({
    where: and(
      eq(schema.KnowledgeBase.organizationId, organizationId),
      eq(schema.KnowledgeBase.kind, 'learned')
    ),
  })
  return kb ?? null
}

async function provisionLearnedKb(ctx: KBContext): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  const creatorId = await resolveCreatorId(db, ctx.organizationId)
  try {
    return await createKnowledgeBase(
      ctx,
      {
        name: LEARNED_KB_NAME,
        slug: LEARNED_KB_SLUG,
        kind: 'learned',
        visibility: 'INTERNAL',
        publishStatus: 'DRAFT',
      },
      creatorId
    )
  } catch (error) {
    // Concurrent provision: the org-scoped slug uniqueness rejected us — the
    // winner's row must exist now.
    const existing = await findLearnedKb(db, ctx.organizationId)
    if (existing) {
      logger.info('Learned KB provisioned concurrently; using existing row', {
        organizationId: ctx.organizationId,
        knowledgeBaseId: existing.id,
      })
      return existing
    }
    throw error
  }
}

/**
 * Resolve a non-null creator/editor for provisioned rows: the org's system
 * user when present, else any member (mirrors the Knowledge Sources fallback).
 */
async function resolveCreatorId(db: Database, organizationId: string): Promise<string> {
  const org = await db.query.Organization.findFirst({
    where: eq(schema.Organization.id, organizationId),
    columns: { systemUserId: true },
  })
  if (org?.systemUserId) return org.systemUserId
  const member = await db.query.OrganizationMember.findFirst({
    where: eq(schema.OrganizationMember.organizationId, organizationId),
    columns: { userId: true },
  })
  if (!member) throw new NotFoundError(`No members found for organization '${organizationId}'`)
  return member.userId
}

/**
 * Ensure the three skeleton categories exist and are published (an unpublished
 * category would be pruned from the Knowledge Catalog and its children
 * promoted, flattening the taxonomy).
 */
async function ensureSkeletonCategories(
  ctx: KBContext,
  kb: KnowledgeBase
): Promise<Record<LearnedCategoryKey, string>> {
  const db = resolveDb(ctx)
  const existing = await db.query.Article.findMany({
    where: and(
      eq(schema.Article.organizationId, ctx.organizationId),
      eq(schema.Article.homeKnowledgeBaseId, kb.id),
      inArray(schema.Article.sourceExternalId, LEARNED_CATEGORY_KEYS.map(categoryExternalId))
    ),
    columns: { id: true, sourceExternalId: true },
  })
  const byExternalId = new Map(existing.map((a) => [a.sourceExternalId, a.id]))

  const categoryIds = {} as Record<LearnedCategoryKey, string>
  for (const key of LEARNED_CATEGORY_KEYS) {
    const found = byExternalId.get(categoryExternalId(key))
    if (found) {
      categoryIds[key] = found
      continue
    }
    const { title, description } = LEARNED_CATEGORIES[key]
    const created = await createArticle(
      ctx,
      kb.id,
      {
        articleKind: 'category',
        title,
        description,
        slug: key,
        sourceExternalId: categoryExternalId(key),
      },
      kb.createdById
    )
    await publishArticle(ctx, created.id, kb.createdById, [], kb.id)
    categoryIds[key] = created.id
  }
  return categoryIds
}
