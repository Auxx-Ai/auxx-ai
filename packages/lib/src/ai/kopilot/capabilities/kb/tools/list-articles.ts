// packages/lib/src/ai/kopilot/capabilities/kb/tools/list-articles.ts

import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../../../../cache'
import { KBService } from '../../../../../kb/kb-service'
import { articleToMarkdown } from '../../../../../kb/markdown/article-to-markdown'
import type { ArticleNodeJSON } from '../../../../../kb/markdown/types'
import { parseArticleIdArrayArg, parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const CONTENT_LIMIT_MAX = 10
const PREVIEW_CHARS = 4_000

export function createListArticlesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_articles',
    displayName: 'List articles',
    toolsetSlug: 'knowledge',
    idempotent: true,
    description:
      'List KB articles. Always returns id, recordId, slug, title, excerpt, status, parentId, knowledgeBaseId, isPublished, hasUnpublishedChanges. Set `includeContent: true` to also attach a 4K-char `bodyMarkdown` preview per row (capped at limit ≤ 10 when on). Filter by `articleIds`, `knowledgeBaseId` (defaults to active KB; if none, lists across all KBs), substring `query` on title, `parentId`, or `includeUnpublished`. For the full untruncated body of a specific article, use `get_article`.',
    parameters: {
      type: 'object',
      properties: {
        articleIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. Restrict to these articles. Each id can be bare or `article:<id>` recordId form. Combines (intersects) with other filters.',
        },
        knowledgeBaseId: {
          type: 'string',
          description: 'Optional. KB to list from. Defaults to the active KB ref.',
        },
        query: {
          type: 'string',
          description: 'Optional substring filter on article titles (case-insensitive).',
        },
        parentId: {
          type: 'string',
          description: 'Only return articles with this parent id.',
        },
        includeUnpublished: {
          type: 'boolean',
          description: 'Include drafts (default true — agents typically operate on drafts).',
        },
        includeContent: {
          type: 'boolean',
          description: `Optional. When true, attach \`bodyMarkdown\` (truncated to ${PREVIEW_CHARS} chars per row) and \`bodyTruncated\`. Forces \`limit ≤ ${CONTENT_LIMIT_MAX}\`. Off by default — for the full body of a specific article use \`get_article\`.`,
        },
        limit: {
          type: 'number',
          description: `Max results (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}; max ${CONTENT_LIMIT_MAX} when includeContent is true).`,
        },
      },
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const out: Record<string, unknown> = { ...args }
      if (args.articleIds !== undefined) {
        const ids = parseArticleIdArrayArg(args.articleIds, { name: 'articleIds' })
        if (!ids.ok) return { ok: false, error: ids.error }
        out.articleIds = ids.value
      }
      if (args.query !== undefined) {
        const q = parseStringArg(args.query, { name: 'query', max: 200 })
        if (!q.ok) return { ok: false, error: q.error }
        out.query = q.value
      }
      return { ok: true, args: out }
    },
    execute: async (args, agentDeps) => {
      const { db, sessionContext } = getDeps()
      const requestedKb = args.knowledgeBaseId as string | undefined
      const activeKb = findRef(sessionContext, 'kb')?.id
      const scopeKbId: string | undefined = requestedKb ?? activeKb

      const idFilter = args.articleIds as string[] | undefined
      const query = (args.query as string | undefined)?.toLowerCase()
      const parentId = args.parentId as string | undefined
      const includeUnpublished = (args.includeUnpublished as boolean | undefined) ?? true
      const includeContent = (args.includeContent as boolean | undefined) ?? false
      const effectiveMax = includeContent ? CONTENT_LIMIT_MAX : MAX_LIMIT
      const limit = Math.min((args.limit as number) || DEFAULT_LIMIT, effectiveMax)

      const kb = new KBService(db, agentDeps.organizationId)
      const [all, articleEntityDefinitionId] = await Promise.all([
        scopeKbId
          ? kb.getArticles(scopeKbId, { includeUnpublished })
          : kb.getAllArticles({ includeUnpublished }),
        getCachedEntityDefId(agentDeps.organizationId, 'article'),
      ])

      let filtered = all
      if (idFilter && idFilter.length > 0) {
        const idSet = new Set(idFilter)
        filtered = filtered.filter((a) => idSet.has(a.id))
      }
      if (parentId !== undefined) filtered = filtered.filter((a) => a.parentId === parentId)
      if (query) filtered = filtered.filter((a) => a.title?.toLowerCase().includes(query))
      const trimmed = filtered.slice(0, limit)

      // When includeContent is on, fetch draft contentJson for the trimmed
      // set in one query and render each to markdown. Truncate per row.
      let bodyById: Map<string, { body: string; truncated: boolean }> | undefined
      if (includeContent && trimmed.length > 0) {
        const ids = trimmed.map((a) => a.id)
        const rows = await db.query.Article.findMany({
          where: and(
            inArray(schema.Article.id, ids),
            eq(schema.Article.organizationId, agentDeps.organizationId)
          ),
          with: { draftRevision: true },
        })
        bodyById = new Map()
        for (const r of rows) {
          const contentJson = (r.draftRevision?.contentJson as ArticleNodeJSON[] | null) ?? []
          const full = articleToMarkdown({ contentJson })
          if (full.length <= PREVIEW_CHARS) {
            bodyById.set(r.id, { body: full, truncated: false })
          } else {
            const slice = full.slice(0, PREVIEW_CHARS)
            const lastNewline = slice.lastIndexOf('\n')
            const cut = lastNewline > 0 ? slice.slice(0, lastNewline) : slice
            bodyById.set(r.id, { body: cut, truncated: true })
          }
        }
      }

      return {
        success: true,
        output: {
          articles: trimmed.map((a) => {
            const base = {
              id: a.id,
              recordId: articleEntityDefinitionId
                ? `${articleEntityDefinitionId}:${a.id}`
                : `article:${a.id}`,
              displayName: a.title || a.slug,
              secondaryInfo: a.slug,
              knowledgeBaseId: a.knowledgeBaseId,
              slug: a.slug,
              title: a.title,
              excerpt: a.excerpt,
              status: a.status,
              parentId: a.parentId,
              isPublished: a.isPublished,
              hasUnpublishedChanges: a.hasUnpublishedChanges,
            }
            if (!includeContent) return base
            const body = bodyById?.get(a.id)
            return {
              ...base,
              bodyMarkdown: body?.body ?? '',
              bodyTruncated: body?.truncated ?? false,
            }
          }),
          count: trimmed.length,
          total: filtered.length,
        },
      }
    },
  }
}
