// packages/lib/src/ai/kopilot/capabilities/learned/tools/upsert-learned-article.ts
// Whole-markdown upsert into the org's learned KB (AI memory). Thin wrapper
// over the article-sink primitives (createArticle/updateArticleDraft +
// mdToBlocks) plus publish — every real execution is either approval-gated
// (capture replay) or an explicit user ask, so publishing here is the trust
// gate working as designed. See plans/memory/learned-kb-plan.md Phase 2.

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createArticle } from '../../../../../kb/articles/create-article'
import { publishArticle } from '../../../../../kb/articles/publish-article'
import { updateArticleDraft } from '../../../../../kb/articles/update-article'
import {
  ensureLearnedKb,
  LEARNED_CATEGORY_KEYS,
  type LearnedCategoryKey,
} from '../../../../../kb/learned/ensure-learned-kb'
import { mdToBlocks } from '../../../../../kb/markdown/md-to-blocks'
import {
  getKnownDefIds,
  normalizeRecordIdArg,
  parseArticleIdArg,
  parseStringArg,
} from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const UpsertLearnedArticleOutput = z.object({
  articleId: z.string(),
  title: z.string(),
  created: z.boolean(),
  published: z.boolean(),
})

/**
 * Guarantee the article carries an inline reference chip to `recordId` so its
 * indexed segments get `metadata.links[]` (record-scoped recall). Appends a
 * trailing reference line when the markdown doesn't already include the chip.
 */
export function withRecordChip(markdown: string, recordId?: string): string {
  if (!recordId || markdown.includes(`@[${recordId}]`)) return markdown
  return `${markdown.trimEnd()}\n\nRelated record: @[${recordId}]\n`
}

export function createUpsertLearnedArticleTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'upsert_learned_article',
    displayName: 'Save learned article',
    // Always-on (no toolsetSlug): availability is controlled by where the
    // capability is registered (learnedMemory-flagged interactive registry +
    // the headless extraction runner), not by per-org/agent toolset config.
    // Safe because every write is approval-gated.
    requiresApproval: true,
    outputSchema: UpsertLearnedArticleOutput,
    exampleOutput: {
      articleId: 'art_9Xk2Mv',
      title: 'Refund policy',
      created: false,
      published: true,
    } satisfies z.output<typeof UpsertLearnedArticleOutput>,
    description:
      "Create or update an article in the organization's learned knowledge base (AI memory) and publish it. " +
      'ALWAYS check the Knowledge Catalog (or list_articles) for an existing article covering the topic first — if one exists, pass its articleId instead of creating a near-duplicate. ' +
      'When updating, read the current article with get_article first and pass the FULL merged markdown: preserve existing content, especially anything a human wrote or corrected — never drop it. ' +
      '`description` is the one-line summary shown in the Knowledge Catalog; keep it accurate on every write. ' +
      'For an article about a specific contact or company, pass its recordId so the article is linked to that record.',
    summary: (args) => {
      const title = typeof args.title === 'string' ? args.title : 'learned article'
      const verb = args.articleId ? 'Update' : 'Save'
      return `${verb} learned article: "${title.slice(0, 60)}"`
    },
    captureMint: (args, ctx) => ({
      articleId:
        typeof args.articleId === 'string' && args.articleId.length > 0
          ? args.articleId
          : `temp_${ctx.localIndex}`,
      title: typeof args.title === 'string' ? args.title : '',
      created: !args.articleId,
      published: true,
    }),
    parameters: {
      type: 'object',
      properties: {
        articleId: {
          type: 'string',
          description:
            'Existing learned article to update (from the Knowledge Catalog or list_articles). Omit to create a new article.',
        },
        category: {
          type: 'string',
          enum: [...LEARNED_CATEGORY_KEYS],
          description:
            "Where a NEW article is filed: 'policies' for topical org knowledge, 'companies'/'contacts' for per-record articles. Required when creating; ignored on update.",
        },
        title: {
          type: 'string',
          description: 'Article title (one topic per article, e.g. "Refund policy")',
        },
        description: {
          type: 'string',
          description:
            'One-line summary of what the article covers — shown in the Knowledge Catalog',
        },
        markdown: {
          type: 'string',
          description:
            'The FULL article content as markdown (replaces the article body; merge in existing content when updating)',
        },
        recordId: {
          type: 'string',
          description:
            'For contact/company articles: the record this article is about (format <entityDefinitionId>:<entityInstanceId>)',
        },
      },
      required: ['title', 'description', 'markdown'],
      additionalProperties: false,
    },
    validateInputs: async (args, ctx) => {
      const title = parseStringArg(args.title, { name: 'title', required: true, max: 300 })
      if (!title.ok) return { ok: false, error: title.error }

      const description = parseStringArg(args.description, {
        name: 'description',
        required: true,
        max: 500,
      })
      if (!description.ok) return { ok: false, error: description.error }

      const markdown = parseStringArg(args.markdown, {
        name: 'markdown',
        required: true,
        max: 100_000,
      })
      if (!markdown.ok) return { ok: false, error: markdown.error }

      const articleId = parseArticleIdArg(args.articleId)
      if (!articleId.ok) return { ok: false, error: articleId.error }

      const category = args.category as LearnedCategoryKey | undefined
      if (!articleId.value) {
        if (!category || !LEARNED_CATEGORY_KEYS.includes(category)) {
          return {
            ok: false,
            error: `category is required when creating a new article; expected one of ${LEARNED_CATEGORY_KEYS.join(' | ')}.`,
          }
        }
      }

      let recordId: string | undefined
      const warnings: string[] = []
      if (args.recordId !== undefined && args.recordId !== null && args.recordId !== '') {
        const known = await getKnownDefIds(ctx.organizationId)
        const parsed = normalizeRecordIdArg(args.recordId, { knownDefIds: known })
        if (!parsed.ok) return { ok: false, error: parsed.error }
        recordId = parsed.value
        if (parsed.warnings) warnings.push(...parsed.warnings)
      }

      return {
        ok: true,
        args: {
          articleId: articleId.value,
          category,
          title: title.value,
          description: description.value,
          markdown: markdown.value,
          recordId,
        },
        warnings,
      }
    },
    execute: async (args, agentDeps) => {
      const { db, capabilities } = getDeps()
      const { organizationId, userId } = agentDeps
      const ctx = { db, organizationId }

      const { kb, categoryIds } = await ensureLearnedKb(ctx)

      // Instance-access write gate (permissions v2 §3.3): the learned KB is a
      // real KnowledgeBase, so writing AI memory needs Edit on that instance.
      // Throws `ForbiddenError`; absent capabilities ⇒ unrestricted, as before.
      capabilities?.assertEditInstance('kb', kb.id)

      const title = args.title as string
      const description = args.description as string
      const markdown = withRecordChip(args.markdown as string, args.recordId as string | undefined)
      const contentJson = mdToBlocks(markdown)
      const articleId = args.articleId as string | undefined

      if (articleId) {
        const existing = await db.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, articleId),
            eq(schema.Article.organizationId, organizationId)
          ),
          columns: { id: true, homeKnowledgeBaseId: true, articleKind: true },
        })
        if (!existing) {
          return { success: false, output: null, error: `Article '${articleId}' not found.` }
        }
        if (existing.homeKnowledgeBaseId !== kb.id) {
          return {
            success: false,
            output: null,
            error: `Article '${articleId}' is not in the learned knowledge base — this tool only writes AI-memory articles.`,
          }
        }
        if (existing.articleKind !== 'page') {
          return {
            success: false,
            output: null,
            error: `Article '${articleId}' is a category, not a page. Create or update an article under it instead.`,
          }
        }
        await updateArticleDraft(ctx, articleId, { title, description, contentJson }, userId, kb.id)
        await publishArticle(ctx, articleId, userId, [], kb.id)
        return {
          success: true,
          output: { articleId, title, created: false, published: true },
        }
      }

      const category = args.category as LearnedCategoryKey
      const created = await createArticle(
        ctx,
        kb.id,
        { articleKind: 'page', parentId: categoryIds[category], title, description, contentJson },
        userId
      )
      await publishArticle(ctx, created.id, userId, [], kb.id)
      return {
        success: true,
        output: { articleId: created.id, title, created: true, published: true },
      }
    },
  }
}
