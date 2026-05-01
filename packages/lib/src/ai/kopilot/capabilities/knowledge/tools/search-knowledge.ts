// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-knowledge.ts

import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { SearchService } from '../../../../../datasets/services/search.service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ArticleSearchDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 10
const DEFAULT_RESULTS = 5
const MAX_CONTENT_LENGTH = 1500

type Source = 'kb' | 'rag' | 'both'

/**
 * Unified hybrid search across KB-managed datasets (article embeddings) and
 * user-uploaded RAG datasets. The two share an embedding pipeline, so we just
 * pick the right dataset id set and let SearchService do the work.
 */
export function createSearchKnowledgeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_knowledge',
    idempotent: true,
    outputDigestSchema: ArticleSearchDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        results?: Array<Record<string, unknown>>
        count?: number
      }
      const results = Array.isArray(out.results) ? out.results : []
      return {
        articleCount: typeof out.count === 'number' ? out.count : results.length,
        titles: takeSample(
          results
            .map((r) => (typeof r.documentTitle === 'string' ? r.documentTitle : null))
            .filter((t): t is string => Boolean(t))
        ),
      }
    },
    usageNotes:
      'For KB articles, cite individual articles in the final message via `[Title](auxx://doc/<docSlug>)` — `docSlug` is on each result. RAG segments have no citable URL; mention them in prose.',
    description:
      "Hybrid (BM25 + vector) search across the organization's knowledge — published KB articles and uploaded RAG documents. Use for written content (articles, manuals, policies, FAQs). Do NOT use for contacts, customers, products, orders, or other entities — use search_entities for that.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query — be descriptive for best semantic matching',
        },
        source: {
          type: 'string',
          enum: ['kb', 'rag', 'both'],
          description: "Which knowledge source to search (default 'both')",
        },
        knowledgeBaseId: {
          type: 'string',
          description: 'Narrow source=kb to a specific KB',
        },
        datasetIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Narrow source=rag to specific dataset IDs',
        },
        recordIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional entity-aware filter — only return segments whose links[] include any of these record IDs',
        },
        limit: {
          type: 'number',
          description: `Max results (default ${DEFAULT_RESULTS}, max ${MAX_RESULTS})`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const query = args.query as string
      const source = ((args.source as Source) ?? 'both') as Source
      const knowledgeBaseId = args.knowledgeBaseId as string | undefined
      const requestedDatasetIds = args.datasetIds as string[] | undefined
      const recordIds = args.recordIds as string[] | undefined
      const limit = Math.min((args.limit as number) || DEFAULT_RESULTS, MAX_RESULTS)

      try {
        const datasetIds = await resolveDatasetIds({
          db,
          organizationId: agentDeps.organizationId,
          source,
          knowledgeBaseId,
          requestedDatasetIds,
        })

        if (datasetIds.length === 0) {
          return {
            success: true,
            output: { results: [], count: 0, message: 'No accessible datasets for this query' },
          }
        }

        const response = await SearchService.search(
          {
            query,
            datasetIds,
            limit: recordIds && recordIds.length > 0 ? Math.max(limit * 3, MAX_RESULTS) : limit,
            searchType: 'hybrid',
            includeMetadata: true,
          },
          agentDeps.organizationId,
          agentDeps.userId
        )

        const filtered =
          recordIds && recordIds.length > 0
            ? response.results.filter((r) => {
                const links = (r.segment.metadata as any)?.links as
                  | Array<{ recordId: string }>
                  | undefined
                if (!links || links.length === 0) return false
                return links.some((l) => recordIds.includes(l.recordId))
              })
            : response.results

        const trimmed = filtered.slice(0, limit)

        if (trimmed.length === 0) {
          return {
            success: true,
            output: {
              results: [],
              count: 0,
              message: 'No matching results. Try rephrasing the query.',
            },
          }
        }

        const results = trimmed.map((r) => {
          const meta = (r.segment.metadata as any) ?? {}
          const isKb = meta.source === 'kb'
          const articleSlugPath = isKb ? (meta.articleSlugPath as string | undefined) : undefined
          const kbSlug = isKb ? (meta.kbSlug as string | undefined) : undefined
          // Slug for `auxx://doc/<slug>` inline links — only for KB items
          // with the necessary metadata. RAG segments have no canonical URL
          // and are skipped.
          const docSlug = kbSlug && articleSlugPath ? `${kbSlug}/${articleSlugPath}` : undefined
          return {
            id: r.segment.id,
            source: isKb ? ('kb' as const) : ('rag' as const),
            content:
              r.segment.content.length > MAX_CONTENT_LENGTH
                ? `${r.segment.content.slice(0, MAX_CONTENT_LENGTH)}...`
                : r.segment.content,
            score: Math.round(r.score * 100) / 100,
            documentTitle: r.segment.document.title || 'Untitled',
            datasetName: r.segment.document.dataset.name,
            datasetId: r.segment.document.dataset.id,
            articleId: isKb ? (meta.articleId as string | undefined) : undefined,
            articleSlug: isKb ? (meta.articleSlug as string | undefined) : undefined,
            articleSlugPath,
            kbId: isKb ? (meta.kbId as string | undefined) : undefined,
            kbSlug,
            docSlug,
            searchType: r.searchType,
          }
        })

        const docs = results
          .filter((r): r is typeof r & { docSlug: string } => Boolean(r.docSlug))
          .map((r) => ({
            slug: r.docSlug,
            title: r.documentTitle,
            description: r.content,
          }))
        // Deduplicate — multiple matching segments can share the same article
        const dedupedDocs = Array.from(new Map(docs.map((d) => [d.slug, d])).values())

        return {
          success: true,
          output: {
            results,
            count: results.length,
            total: response.total,
            docs: dedupedDocs,
          },
        }
      } catch (error) {
        return {
          success: false,
          output: { results: [], count: 0 },
          error: error instanceof Error ? error.message : 'Search failed',
        }
      }
    },
  }
}

async function resolveDatasetIds(args: {
  db: import('@auxx/database').Database
  organizationId: string
  source: Source
  knowledgeBaseId?: string
  requestedDatasetIds?: string[]
}): Promise<string[]> {
  const { db, organizationId, source, knowledgeBaseId, requestedDatasetIds } = args

  if (source === 'kb') {
    return collectManagedDatasetIds(db, organizationId, knowledgeBaseId)
  }
  if (source === 'rag') {
    const rows = await db
      .select({ id: schema.Dataset.id })
      .from(schema.Dataset)
      .where(
        and(
          eq(schema.Dataset.organizationId, organizationId),
          eq(schema.Dataset.isManaged, false),
          requestedDatasetIds && requestedDatasetIds.length > 0
            ? inArray(schema.Dataset.id, requestedDatasetIds)
            : undefined
        )
      )
    return rows.map((r) => r.id)
  }
  // both
  const [kb, rag] = await Promise.all([
    collectManagedDatasetIds(db, organizationId, knowledgeBaseId),
    db
      .select({ id: schema.Dataset.id })
      .from(schema.Dataset)
      .where(
        and(
          eq(schema.Dataset.organizationId, organizationId),
          eq(schema.Dataset.isManaged, false),
          requestedDatasetIds && requestedDatasetIds.length > 0
            ? inArray(schema.Dataset.id, requestedDatasetIds)
            : undefined
        )
      )
      .then((rows) => rows.map((r) => r.id)),
  ])
  return [...new Set([...kb, ...rag])]
}

async function collectManagedDatasetIds(
  db: import('@auxx/database').Database,
  organizationId: string,
  knowledgeBaseId?: string
): Promise<string[]> {
  if (knowledgeBaseId) {
    const [kb] = await db
      .select({ datasetId: schema.KnowledgeBase.datasetId })
      .from(schema.KnowledgeBase)
      .where(
        and(
          eq(schema.KnowledgeBase.id, knowledgeBaseId),
          eq(schema.KnowledgeBase.organizationId, organizationId)
        )
      )
      .limit(1)
    return kb?.datasetId ? [kb.datasetId] : []
  }
  const rows = await db
    .select({ id: schema.Dataset.id })
    .from(schema.Dataset)
    .where(
      and(eq(schema.Dataset.organizationId, organizationId), eq(schema.Dataset.isManaged, true))
    )
  return rows.map((r) => r.id)
}
