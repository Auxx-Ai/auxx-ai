// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-knowledge.ts

import { z } from 'zod'
import type { ResolvedKnowledgeScope } from '../../../../../agents/resolve-knowledge-scope'
import {
  type KnowledgeSource,
  knowledgeTargetsForSource,
  resolveKnowledgeDatasetIds,
} from '../../../../../datasets/resolve-knowledge-targets'
import { SearchService } from '../../../../../datasets/services/search.service'
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

/** Alias, not a copy — the two cannot drift. */
type Source = KnowledgeSource

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
 *     knowledge this agent should draw from. Narrows
 *     `resolveKnowledgeDatasetIds`' dataset set (1a) and, for KB segments,
 *     narrows further at the article
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
    permission: {
      target: 'instance',
      keys: ['kb', 'dataset'],
      level: 'view',
      enforcement: 'enforced',
      note: 'resolveKnowledgeDatasetIds → canViewInstance per kb/dataset, intersected with the agent’s knowledgeScope and clamped to PUBLIC articles on a visitor turn.',
    },
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
        const resolved = await resolveKnowledgeDatasetIds(db, {
          organizationId: agentDeps.organizationId,
          targets: knowledgeTargetsForSource(source, knowledgeBaseId, requestedDatasetIds),
          publicOnly: isChat,
          // `capabilities: undefined` ⇒ unrestricted is the load-bearing
          // convention for the headless construction sites that legitimately
          // pass it (master-Kopilot job runs, pre-setup drafts — see
          // `ToolDeps.capabilities`). Spelling it as `'unrestricted'` here
          // preserves that exactly while removing the *implicit* fail-open arm
          // from the resolver, so a new caller can no longer get an unfiltered
          // retrieval set by forgetting the field.
          capabilities: capabilities ?? 'unrestricted',
          knowledgeScope: knowledgeScope ?? null,
        })
        if (resolved.isErr()) throw resolved.error
        const datasetIds = resolved.value

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
