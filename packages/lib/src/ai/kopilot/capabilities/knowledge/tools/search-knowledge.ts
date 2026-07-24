// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-knowledge.ts

import { schema } from '@auxx/database'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import type { ResolvedKnowledgeScope } from '../../../../../agents/resolve-knowledge-scope'
import { SearchService } from '../../../../../datasets/services/search.service'
import type { CapabilityView } from '../../../../../permissions/capabilities/capability-view'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

/**
 * Full success output of `search_knowledge`. Empty-result branches return just
 * `{ results: [], count: 0, message }`; the populated branch adds `total` and
 * `docs`, and either branch may carry `warnings` when one search lane failed.
 */
const SearchKnowledgeOutput = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      source: z.enum(['kb', 'rag']),
      content: z.string(),
      score: z.number(),
      documentTitle: z.string(),
      datasetName: z.string(),
      datasetId: z.string(),
      articleId: z.string().optional(),
      articleSlug: z.string().optional(),
      articleSlugPath: z.string().optional(),
      kbId: z.string().optional(),
      kbSlug: z.string().optional(),
      docSlug: z.string().optional(),
      searchType: z.string(),
    })
  ),
  count: z.number(),
  total: z.number().optional(),
  message: z.string().optional(),
  docs: z
    .array(
      z.object({
        slug: z.string(),
        title: z.string(),
        description: z.string(),
      })
    )
    .optional(),
  warnings: z.array(z.string()).optional(),
})

const MAX_RESULTS = 10
const DEFAULT_RESULTS = 5
const MAX_CONTENT_LENGTH = 1500

type Source = 'kb' | 'rag' | 'both'

/**
 * Unified hybrid search across KB-managed datasets (article embeddings) and
 * user-uploaded RAG datasets. The two share an embedding pipeline, so we just
 * pick the right dataset id set and let SearchService do the work.
 *
 * Three narrowings stack on the searchable set, in this order:
 *  1. Visitor PUBLIC clamp (`publicOnly` / `isChat` below) — **security**. An
 *     untrusted external caller must never reach an INTERNAL KB or any RAG
 *     dataset, full stop.
 *  2. Agent retrieval scope (`knowledgeScope`, permissions v2 §1.2/1.3) —
 *     **relevance-by-design**, not a security boundary of its own: it's the
 *     agent author's choice of which of the org's *otherwise-accessible*
 *     knowledge this agent should draw from. Narrows `resolveDatasetIds`'
 *     dataset set (1a) and, for KB segments, narrows further at the article
 *     level via {@link isSegmentInKnowledgeScope} (1b) — a dataset in scope
 *     can still hold articles the scope excludes.
 *  3. Capability instance-access (`capabilities`, doc-14) — **security**.
 *     Read enforcement for the acting principal; a KB/dataset the scope
 *     allows but the principal can't view is still dropped.
 * `null`/`undefined` `knowledgeScope` is unrestricted org-wide, exactly
 * today's pre-scope behaviour, with no added queries.
 */
export function createSearchKnowledgeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_knowledge',
    displayName: 'Search knowledge',
    toolsetSlug: 'auxx:knowledge',
    idempotent: true,
    // Verified safe for an untrusted external caller: in chat context
    // (`ctx.subject` set) the search self-clamps to PUBLIC knowledge bases
    // and excludes RAG datasets — see the execute clamp below. Offered on all
    // surfaces (default); `externalSafe` drops the chat/email warning. See
    // plans/chat/v6/chat-tool-availability.md.
    externalSafe: true,
    outputSchema: SearchKnowledgeOutput,
    exampleOutput: {
      results: [
        {
          id: 'seg_4hT9kP',
          source: 'kb',
          content:
            'Refunds are issued to the original payment method within 5-7 business days once the returned item is received and inspected.',
          score: 0.92,
          documentTitle: 'Refund policy',
          datasetName: 'Help Center',
          datasetId: 'ds_kb_help',
          articleId: 'art_refunds',
          articleSlug: 'refund-policy',
          articleSlugPath: 'policies/refund-policy',
          kbId: 'kb_public',
          kbSlug: 'help',
          docSlug: 'help/policies/refund-policy',
          searchType: 'hybrid',
        },
      ],
      count: 1,
      total: 1,
      docs: [
        {
          slug: 'help/policies/refund-policy',
          title: 'Refund policy',
          description:
            'Refunds are issued to the original payment method within 5-7 business days once the returned item is received and inspected.',
        },
      ],
    } satisfies z.output<typeof SearchKnowledgeOutput>,
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
      "Hybrid (keyword + semantic) search across the organization's knowledge — published KB articles and uploaded RAG documents. Returns the best-matching passage per article/document; follow the `articleId`/`docSlug` into get_article for full context. If the Knowledge Catalog in your context already lists a clearly relevant article, skip this and read it directly with get_article. Use for written content (articles, manuals, policies, FAQs). Do NOT use for contacts, customers, products, orders, or other entities — use search_entities for that.",
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
    validateInputs: async (args) => {
      const query = parseStringArg(args.query, { name: 'query', required: true, max: 500 })
      if (!query.ok) return { ok: false, error: query.error }
      return { ok: true, args: { ...args, query: query.value } }
    },
    execute: async (args, agentDeps) => {
      const { db, capabilities, knowledgeScope } = getDeps()
      const query = args.query as string
      const requestedSource = ((args.source as Source) ?? 'both') as Source
      const knowledgeBaseId = args.knowledgeBaseId as string | undefined
      const requestedDatasetIds = args.datasetIds as string[] | undefined
      const recordIds = args.recordIds as string[] | undefined
      const limit = Math.min((args.limit as number) || DEFAULT_RESULTS, MAX_RESULTS)

      // Chat clamp (decision 6): a visitor-initiated turn carries a `subject`.
      // Force source to PUBLIC KB only — RAG datasets are internal uploads with
      // no visibility tier, so they're excluded, and the KB set is restricted to
      // PUBLIC knowledge bases. A visitor-supplied `knowledgeBaseId` still
      // composes, but only narrows *within* the PUBLIC ceiling (an INTERNAL KB
      // id resolves to no datasets). Internal kopilot / autonomous runs leave
      // `subject` undefined and keep full access.
      const isChat = agentDeps.subject !== undefined
      const source: Source = isChat ? 'kb' : requestedSource

      try {
        const datasetIds = await resolveDatasetIds({
          db,
          organizationId: agentDeps.organizationId,
          source,
          knowledgeBaseId,
          requestedDatasetIds,
          publicOnly: isChat,
          capabilities,
          knowledgeScope,
        })

        if (datasetIds.length === 0) {
          return {
            success: true,
            output: { results: [], count: 0, message: 'No accessible datasets for this query' },
          }
        }

        // Over-fetch: results below are deduped to one segment per article
        // (and optionally post-filtered by recordIds), so the raw segment list
        // must be several times the requested page to survive the cuts.
        const response = await SearchService.search(
          {
            query,
            datasetIds,
            limit: Math.min(Math.max(limit * 3, 15), 50),
            searchType: 'hybrid',
            includeMetadata: true,
          },
          agentDeps.organizationId,
          agentDeps.userId
        )

        const filtered = response.results.filter((r) => {
          const meta = (r.segment.metadata as any) ?? {}
          if (recordIds && recordIds.length > 0) {
            const links = meta.links as Array<{ recordId: string }> | undefined
            if (!links || links.length === 0) return false
            if (!links.some((l) => recordIds.includes(l.recordId))) return false
          }
          // Agent retrieval scope (permissions v2 §1.2/1.3) — relevance/security
          // narrowing stacked on top of the dataset-level filter above, needed
          // because a partially-scoped KB's segments still share the KB's
          // dataset with its out-of-scope siblings.
          return isSegmentInKnowledgeScope(meta, knowledgeScope)
        })

        // One result per article (KB) / document (RAG): results arrive score-
        // sorted, so the first segment seen for a source is its best passage.
        // Without this, one long article can occupy every slot and crowd out
        // other relevant sources.
        const seenSources = new Set<string>()
        const grouped = filtered.filter((r) => {
          const meta = (r.segment.metadata as any) ?? {}
          const key = (meta.articleId as string | undefined) ?? r.segment.documentId ?? r.segment.id
          if (seenSources.has(key)) return false
          seenSources.add(key)
          return true
        })

        const trimmed = grouped.slice(0, limit)

        // Hybrid runs vector + text in parallel via Promise.allSettled. If one
        // side throws (e.g. embedding-model mismatch), results may be missing
        // semantic matches or exact-text matches — surface that so the agent
        // can adjust its strategy instead of silently rephrasing forever.
        const warnings: string[] = []
        if (response.metrics?.vectorFailed) {
          warnings.push(
            `Semantic (vector) search unavailable: ${response.metrics.vectorFailed}. Results are text-only and may miss paraphrased matches.`
          )
        }
        if (response.metrics?.textFailed) {
          warnings.push(
            `Keyword (text) search unavailable: ${response.metrics.textFailed}. Results are vector-only.`
          )
        }

        if (trimmed.length === 0) {
          const message =
            warnings.length > 0
              ? `No matching results. ${warnings.join(' ')}`
              : 'No matching results. Try rephrasing the query.'
          return {
            success: true,
            output: { results: [], count: 0, message, ...(warnings.length ? { warnings } : {}) },
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
            ...(warnings.length ? { warnings } : {}),
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

/**
 * Article-level narrowing gate for a single search result (permissions v2
 * §1.2/1.3 — agent retrieval scope). Pure and DB-free: `scope` is already
 * fully resolved by `resolveAgentKnowledgeScope`, so this is a plain set
 * lookup, not a re-derivation of KB/article inclusion.
 *
 * `null`/`undefined` scope ⇒ unrestricted, always keep (today's behaviour).
 * A RAG segment (`meta.source !== 'kb'`) is always kept here too — RAG has no
 * article concept, and it's already governed by the dataset-level
 * `datasetIds` intersection in {@link resolveDatasetIds}.
 *
 * Deliberate deferral (plan §4): this filters the over-fetched result set in
 * memory rather than pushing a `searchMetadata->>'articleId'` predicate into
 * `SearchService.search` / `searchByVectorMultiDataset`. The existing
 * `limit * 3` over-fetch (capped 50) already leaves headroom for this
 * post-filter; pushing the predicate into the vector query is the follow-up
 * if scoped-article recall proves thin in practice, not part of this slice.
 */
export function isSegmentInKnowledgeScope(
  meta: { source?: string; articleId?: string; kbId?: string },
  scope: ResolvedKnowledgeScope | null | undefined
): boolean {
  if (!scope) return true
  if (meta.source !== 'kb') return true
  if (meta.articleId !== undefined && scope.excludedArticleIds.has(meta.articleId)) return false
  if (meta.kbId !== undefined && scope.fullKbIds.has(meta.kbId)) return true
  if (meta.articleId !== undefined && scope.articleIds.has(meta.articleId)) return true
  return false
}

async function resolveDatasetIds(args: {
  db: import('@auxx/database').Database
  organizationId: string
  source: Source
  knowledgeBaseId?: string
  requestedDatasetIds?: string[]
  /** Chat clamp — restrict managed datasets to PUBLIC knowledge bases. */
  publicOnly?: boolean
  /** Resolved instance-access gate for the turn; absent ⇒ unrestricted. */
  capabilities?: CapabilityView
  /**
   * Agent retrieval scope (permissions v2 §1.2/1.3). Intersected with the
   * collected dataset ids below — narrows, never adds — before the
   * capability instance-access filter runs. `null`/`undefined` ⇒ unrestricted
   * and zero added I/O (a plain array filter, no extra query either way).
   */
  knowledgeScope?: ResolvedKnowledgeScope | null
}): Promise<string[]> {
  const {
    db,
    organizationId,
    source,
    knowledgeBaseId,
    requestedDatasetIds,
    publicOnly,
    capabilities,
    knowledgeScope,
  } = args

  const ids = await collectDatasetIds({
    db,
    organizationId,
    source,
    knowledgeBaseId,
    requestedDatasetIds,
    publicOnly,
  })
  // Cheap in-memory intersection, no I/O — runs before the capability filter's
  // extra KB query so a scope that already narrows to nothing skips it
  // entirely. Absent scope is a no-op pass-through.
  const scoped = knowledgeScope ? ids.filter((id) => knowledgeScope.datasetIds.has(id)) : ids
  return filterAccessibleDatasetIds(db, organizationId, scoped, capabilities)
}

async function collectDatasetIds(args: {
  db: import('@auxx/database').Database
  organizationId: string
  source: Source
  knowledgeBaseId?: string
  requestedDatasetIds?: string[]
  publicOnly?: boolean
}): Promise<string[]> {
  const { db, organizationId, source, knowledgeBaseId, requestedDatasetIds, publicOnly } = args

  if (source === 'kb') {
    return collectManagedDatasetIds(db, organizationId, knowledgeBaseId, publicOnly)
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

/**
 * Instance-access read gate for the searchable set (permissions v2 §3.3, doc-11
 * "Read = use in search/agents"). Every branch above funnels through here, so a
 * dataset the principal can't view — or a managed dataset whose backing KB the
 * principal can't view — never reaches `SearchService`.
 *
 * A KB-backed dataset is governed by its **KB** instance grant (that's the
 * container an admin actually shares); only standalone RAG datasets fall back
 * to the `dataset` key. Silent filter: an empty result is a normal empty search,
 * never a 403.
 *
 * Zero extra I/O when `capabilities` is absent — the whole function
 * short-circuits, so the un-threaded workflow AI node issues exactly the same
 * queries it does today.
 */
async function filterAccessibleDatasetIds(
  db: import('@auxx/database').Database,
  organizationId: string,
  datasetIds: string[],
  capabilities?: CapabilityView
): Promise<string[]> {
  if (!capabilities || datasetIds.length === 0) return datasetIds

  const kbRows = await db
    .select({ id: schema.KnowledgeBase.id, datasetId: schema.KnowledgeBase.datasetId })
    .from(schema.KnowledgeBase)
    .where(eq(schema.KnowledgeBase.organizationId, organizationId))

  const kbIdByDatasetId = new Map<string, string>()
  for (const row of kbRows) {
    if (row.datasetId) kbIdByDatasetId.set(row.datasetId, row.id)
  }

  return datasetIds.filter((datasetId) => {
    const kbId = kbIdByDatasetId.get(datasetId)
    return kbId
      ? capabilities.canViewInstance('kb', kbId)
      : capabilities.canViewInstance('dataset', datasetId)
  })
}

async function collectManagedDatasetIds(
  db: import('@auxx/database').Database,
  organizationId: string,
  knowledgeBaseId?: string,
  publicOnly?: boolean
): Promise<string[]> {
  if (knowledgeBaseId) {
    const [kb] = await db
      .select({ datasetId: schema.KnowledgeBase.datasetId })
      .from(schema.KnowledgeBase)
      .where(
        and(
          eq(schema.KnowledgeBase.id, knowledgeBaseId),
          eq(schema.KnowledgeBase.organizationId, organizationId),
          // Chat clamp — an INTERNAL KB id resolves to no datasets.
          publicOnly ? eq(schema.KnowledgeBase.visibility, 'PUBLIC') : undefined
        )
      )
      .limit(1)
    if (!kb) return []
    const datasetIds = kb.datasetId ? [kb.datasetId] : []

    // Federate: a source linked into this KB embeds its content once in its own hidden
    // KB's dataset, so include those datasets here. Search stays embed-once.
    const linkRows = await db
      .selectDistinct({ sourceId: schema.ArticlePlacement.linkedFromSourceId })
      .from(schema.ArticlePlacement)
      .where(
        and(
          eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
          eq(schema.ArticlePlacement.organizationId, organizationId),
          isNotNull(schema.ArticlePlacement.linkedFromSourceId)
        )
      )
    const sourceIds = linkRows.map((r) => r.sourceId).filter((id): id is string => Boolean(id))
    if (sourceIds.length > 0) {
      const sources = await db
        .select({ ownedKnowledgeBaseId: schema.KnowledgeSource.ownedKnowledgeBaseId })
        .from(schema.KnowledgeSource)
        .where(
          and(
            inArray(schema.KnowledgeSource.id, sourceIds),
            eq(schema.KnowledgeSource.organizationId, organizationId)
          )
        )
      const ownedKbIds = sources.map((s) => s.ownedKnowledgeBaseId)
      if (ownedKbIds.length > 0) {
        const ownedKbs = await db
          .select({ datasetId: schema.KnowledgeBase.datasetId })
          .from(schema.KnowledgeBase)
          .where(inArray(schema.KnowledgeBase.id, ownedKbIds))
        datasetIds.push(
          ...ownedKbs.map((k) => k.datasetId).filter((id): id is string => Boolean(id))
        )
      }
    }
    return [...new Set(datasetIds)]
  }
  // Chat clamp — restrict to datasets backing PUBLIC knowledge bases (RAG
  // datasets are excluded entirely by forcing source='kb' upstream). Internal
  // callers get every managed dataset.
  if (publicOnly) {
    const rows = await db
      .select({ datasetId: schema.KnowledgeBase.datasetId })
      .from(schema.KnowledgeBase)
      .where(
        and(
          eq(schema.KnowledgeBase.organizationId, organizationId),
          eq(schema.KnowledgeBase.visibility, 'PUBLIC')
        )
      )
    return rows.map((r) => r.datasetId).filter((id): id is string => Boolean(id))
  }
  const rows = await db
    .select({ id: schema.Dataset.id })
    .from(schema.Dataset)
    .where(
      and(eq(schema.Dataset.organizationId, organizationId), eq(schema.Dataset.isManaged, true))
    )
  return rows.map((r) => r.id)
}
