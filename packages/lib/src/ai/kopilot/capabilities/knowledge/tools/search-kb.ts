// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-kb.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, ilike, or } from 'drizzle-orm'
import { KBService } from '../../../../../kb'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 10
const MAX_CONTENT_LENGTH = 800

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

/**
 * Search articles by title/content using ILIKE.
 * KBService doesn't have a search method, so we query directly.
 */
async function searchArticles(
  db: Database,
  organizationId: string,
  knowledgeBaseId: string | undefined,
  query: string,
  limit: number
) {
  const conditions = [
    eq(schema.Article.organizationId, organizationId),
    eq(schema.Article.isPublished, true),
    or(
      ilike(schema.Article.title, `%${query}%`),
      ilike(schema.Article.description, `%${query}%`),
      ilike(schema.Article.content, `%${query}%`)
    ),
  ]

  if (knowledgeBaseId) {
    conditions.push(eq(schema.Article.knowledgeBaseId, knowledgeBaseId))
  }

  return db.query.Article.findMany({
    where: and(...conditions),
    limit,
    orderBy: (article, { desc }) => [desc(article.updatedAt)],
    columns: {
      id: true,
      title: true,
      description: true,
      excerpt: true,
      content: true,
      knowledgeBaseId: true,
      slug: true,
      updatedAt: true,
    },
  })
}

export function createSearchKBTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_kb',
    idempotent: true,
    usageNotes: 'Emits a `kb-article-list` block automatically.',
    description:
      "Search the organization's knowledge base for help articles and documentation. Only for written articles/guides (e.g. policies, how-tos, FAQs). Do NOT use this to look up contacts, customers, products, orders, vendors, or any other entity/record — use search_entities for that.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        knowledgeBaseId: {
          type: 'string',
          description: 'Specific KB to search (optional, searches all KBs if omitted)',
        },
        limit: {
          type: 'number',
          description: `Max results (default 5, max ${MAX_RESULTS})`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const query = args.query as string
      const knowledgeBaseId = args.knowledgeBaseId as string | undefined
      const limit = Math.min((args.limit as number) || 5, MAX_RESULTS)

      let kbId = knowledgeBaseId

      // If no KB specified, find the first available KB
      if (!kbId) {
        const kbService = new KBService(db, agentDeps.organizationId)
        const knowledgeBases = await kbService.listKnowledgeBases()
        if (knowledgeBases.length === 0) {
          return {
            success: true,
            output: { articles: [], count: 0, message: 'No knowledge bases found' },
          }
        }
        kbId = knowledgeBases[0]!.id
      }

      const articles = await searchArticles(db, agentDeps.organizationId, kbId, query, limit)

      const results = articles.map((a) => ({
        id: a.id,
        title: a.title,
        excerpt: a.excerpt || a.description || '',
        content: truncate(a.content, MAX_CONTENT_LENGTH),
        knowledgeBaseId: a.knowledgeBaseId,
      }))

      if (results.length === 0) {
        return { success: true, output: { articles: results, count: 0 } }
      }

      return {
        success: true,
        output: { articles: results, count: results.length },
        blocks: [
          {
            type: 'kb-article-list',
            data: {
              query,
              articles: results.map((a) => ({
                id: a.id,
                title: a.title,
                excerpt: a.excerpt,
              })),
            },
          },
        ],
      }
    },
  }
}
