// packages/lib/src/agents/resolve-knowledge-scope.ts

import { type Database, type KnowledgeEntry, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import {
  type AgentKnowledgeScope,
  parseAgentKnowledgeScope,
  scopeHasIncludes,
} from './knowledge-scope'

const logger = createScopedLogger('agent-knowledge-scope')

/**
 * An agent's knowledge scope resolved against the org: concrete dataset ids to
 * search plus the article-level narrowing the segment post-filter applies.
 *
 * `null` (not this type) means unrestricted — see
 * {@link resolveAgentKnowledgeScope}.
 */
export interface ResolvedKnowledgeScope {
  /**
   * Datasets the scope permits. `search_knowledge` intersects its own resolved
   * dataset set with this one — the scope narrows, it never adds a dataset the
   * LLM args or the visitor clamp excluded.
   */
  datasetIds: ReadonlySet<string>
  /**
   * KBs whose entire content is in scope, including the hidden KBs that back
   * linked knowledge sources federated into them. A segment from one of these
   * passes the article filter regardless of its `articleId`.
   */
  fullKbIds: ReadonlySet<string>
  /**
   * Articles in scope on their own, because their KB is only partially
   * included. Segments from a partially-included KB survive only if their
   * `articleId` is in here.
   */
  articleIds: ReadonlySet<string>
  /** Articles excluded outright — dropped even inside a fully-included KB. */
  excludedArticleIds: ReadonlySet<string>
}

interface ResolveArgs {
  db: Database
  organizationId: string
  /** Raw `Agent.knowledge` — entity rows from the old include system are ignored. */
  entries: readonly KnowledgeEntry[] | null | undefined
  /**
   * Doc-14 capability view for the run. When present the scope is intersected
   * with it (§0.4 — narrow, never widen): a scoped KB or dataset the principal
   * cannot view is dropped. Absent ⇒ no intersection, as on the un-threaded
   * workflow AI node.
   */
  capabilities?: CapabilityView
}

/**
 * Resolve an agent's knowledge rows into the concrete set of datasets and
 * articles its retrieval may touch.
 *
 * Returns `null` when the agent has no knowledge-source rows — the org-wide
 * default, and the signal for consumers to skip scope work entirely.
 *
 * Dangling ids (a KB or dataset that has since been deleted) are dropped
 * silently: resolution walks the org's live rows, so a stale id simply never
 * matches. An agent whose only include rows are dangling therefore resolves to
 * an empty scope — nothing in scope, rather than a silent widening back to
 * org-wide.
 */
export async function resolveAgentKnowledgeScope(
  args: ResolveArgs
): Promise<ResolvedKnowledgeScope | null> {
  const scope = parseAgentKnowledgeScope(args.entries)
  if (!scope) return null

  const { db, organizationId, capabilities } = args

  const [kbRows, ragRows] = await Promise.all([
    db
      .select({ id: schema.KnowledgeBase.id, datasetId: schema.KnowledgeBase.datasetId })
      .from(schema.KnowledgeBase)
      .where(eq(schema.KnowledgeBase.organizationId, organizationId)),
    db
      .select({ id: schema.Dataset.id })
      .from(schema.Dataset)
      .where(
        and(eq(schema.Dataset.organizationId, organizationId), eq(schema.Dataset.isManaged, false))
      ),
  ])

  const hasIncludes = scopeHasIncludes(scope)
  const kbIdSet = new Set(kbRows.map((r) => r.id))

  // Articles first: a KB that isn't included whole but contributes articles is
  // still "partially in scope", and its dataset must be searchable for the
  // article post-filter to have anything to filter.
  const articles = await resolveArticleScope(db, organizationId, scope, kbIdSet)

  const { includedKbIds, partialKbIds, includedDatasetIds } = selectScopedSources({
    scope,
    hasIncludes,
    kbIds: [...kbIdSet],
    ragDatasetIds: ragRows.map((r) => r.id),
    kbIdsWithScopedArticles: articles.kbIdsWithScopedArticles,
    capabilities,
  })

  // Federate: a source linked into a scoped KB embeds its content in its own
  // hidden KB's dataset, so those datasets — and those KB ids, which is what
  // the segments carry — belong to the scoped KB's content.
  const searchableKbIds = new Set([...includedKbIds, ...partialKbIds])
  const federated = await resolveFederatedKbs(db, organizationId, searchableKbIds)

  const datasetIdByKbId = new Map<string, string>()
  for (const kb of kbRows) {
    if (kb.datasetId) datasetIdByKbId.set(kb.id, kb.datasetId)
  }

  const datasetIds = new Set<string>(includedDatasetIds)
  for (const kbId of searchableKbIds) {
    const dsId = datasetIdByKbId.get(kbId)
    if (dsId) datasetIds.add(dsId)
  }
  for (const fed of federated.datasetIds) datasetIds.add(fed)

  // A federated KB's segments carry the *hidden* KB's id, so a fully-included
  // parent must vouch for them too, or the article filter would drop them all.
  const fullKbIds = new Set(includedKbIds)
  for (const [parentKbId, ownedKbIds] of federated.ownedKbIdsByParent) {
    if (!includedKbIds.has(parentKbId)) continue
    for (const owned of ownedKbIds) fullKbIds.add(owned)
  }

  if (hasIncludes && datasetIds.size === 0) {
    logger.warn('Agent knowledge scope resolved to nothing searchable', {
      organizationId,
      scopedKbIds: scope.kbIds.length,
      scopedDatasetIds: scope.datasetIds.length,
      scopedArticleIds: scope.articleIds.length + scope.articleTreeIds.length,
    })
  }

  return {
    datasetIds,
    fullKbIds,
    articleIds: articles.articleIds,
    excludedArticleIds: articles.excludedArticleIds,
  }
}

/**
 * The precedence core: decide which KBs and RAG datasets a scope reaches,
 * given the org's live ids. Pure — extracted from
 * {@link resolveAgentKnowledgeScope} so the resolution rules can be tested
 * without a database.
 *
 * - `includedKbIds` — in scope whole.
 * - `partialKbIds` — not in scope whole, but carrying individually scoped
 *   articles, so their dataset must still be searchable for the article
 *   post-filter to have anything to narrow.
 * - `includedDatasetIds` — standalone RAG datasets in scope.
 *
 * Capabilities are applied here (§0.4) so a source the principal cannot view
 * can never reach the returned sets.
 */
export function selectScopedSources(args: {
  scope: AgentKnowledgeScope
  hasIncludes: boolean
  kbIds: readonly string[]
  ragDatasetIds: readonly string[]
  kbIdsWithScopedArticles: ReadonlySet<string>
  capabilities?: CapabilityView
}): {
  includedKbIds: Set<string>
  partialKbIds: Set<string>
  includedDatasetIds: Set<string>
} {
  const { scope, hasIncludes, kbIds, ragDatasetIds, kbIdsWithScopedArticles, capabilities } = args

  const includedKbIds = new Set<string>()
  const partialKbIds = new Set<string>()
  for (const kbId of kbIds) {
    if (kbLevel(scope, kbId, hasIncludes) === 'include') includedKbIds.add(kbId)
    // Most-specific-wins: an explicitly included article outranks the exclusion
    // of its KB, so an excluded KB still goes in as *partial* when it carries
    // one. `kbIdsWithScopedArticles` is computed after article exclusions, so a
    // KB with nothing individually scoped contributes nothing here.
    else if (kbIdsWithScopedArticles.has(kbId)) partialKbIds.add(kbId)
  }

  const includedDatasetIds = new Set<string>()
  for (const datasetId of ragDatasetIds) {
    if (datasetLevel(scope, datasetId, hasIncludes) === 'include') {
      includedDatasetIds.add(datasetId)
    }
  }

  // §0.4 — intersect with the run's capabilities. A KB-backed dataset is
  // governed by its KB grant (the container an admin actually shares), matching
  // `filterAccessibleDatasetIds` in search-knowledge.ts.
  if (capabilities) {
    for (const id of includedKbIds) {
      if (!capabilities.canViewInstance('kb', id)) includedKbIds.delete(id)
    }
    for (const id of partialKbIds) {
      if (!capabilities.canViewInstance('kb', id)) partialKbIds.delete(id)
    }
    for (const id of includedDatasetIds) {
      if (!capabilities.canViewInstance('dataset', id)) includedDatasetIds.delete(id)
    }
  }

  return { includedKbIds, partialKbIds, includedDatasetIds }
}

type ScopeLevel = 'include' | 'exclude' | 'omit'

/**
 * Most-specific-wins, mirroring the builder tree's `deriveEffectiveMode`: the
 * KB's own row beats the definition-level `kb` row, which beats the default.
 * The default is "omit" once anything is explicitly included (an allow-list),
 * and "include" when the scope only carves things out.
 */
function kbLevel(scope: AgentKnowledgeScope, kbId: string, hasIncludes: boolean): ScopeLevel {
  if (scope.kbIds.includes(kbId)) return 'include'
  if (scope.excludedKbIds.includes(kbId)) return 'exclude'
  if (scope.allKbs) return scope.allKbs
  return hasIncludes ? 'omit' : 'include'
}

function datasetLevel(
  scope: AgentKnowledgeScope,
  datasetId: string,
  hasIncludes: boolean
): ScopeLevel {
  if (scope.datasetIds.includes(datasetId)) return 'include'
  if (scope.excludedDatasetIds.includes(datasetId)) return 'exclude'
  if (scope.allDatasets) return scope.allDatasets
  return hasIncludes ? 'omit' : 'include'
}

interface ArticleScope {
  articleIds: Set<string>
  excludedArticleIds: Set<string>
  /** KBs contributing at least one individually-scoped article. */
  kbIdsWithScopedArticles: Set<string>
}

/**
 * Expand the article rows through the placement tree. `include_descendants`
 * carries to the subtree; `include_one` does not; exclusion always does — the
 * same inheritance the builder tree shows.
 */
async function resolveArticleScope(
  db: Database,
  organizationId: string,
  scope: AgentKnowledgeScope,
  orgKbIds: ReadonlySet<string>
): Promise<ArticleScope> {
  const empty: ArticleScope = {
    articleIds: new Set(),
    excludedArticleIds: new Set(),
    kbIdsWithScopedArticles: new Set(),
  }

  const seedIds = [
    ...new Set([...scope.articleIds, ...scope.articleTreeIds, ...scope.excludedArticleIds]),
  ]
  if (seedIds.length === 0) return empty

  const seedPlacements = await db
    .select({
      knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId,
    })
    .from(schema.ArticlePlacement)
    .where(
      and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        inArray(schema.ArticlePlacement.articleId, seedIds)
      )
    )

  const kbIds = [
    ...new Set(seedPlacements.map((p) => p.knowledgeBaseId).filter((id) => orgKbIds.has(id))),
  ]
  if (kbIds.length === 0) return empty

  // One pass over the placements of every KB the seeds live in — enough to walk
  // parent → child without a recursive query.
  const placements = await db
    .select({
      id: schema.ArticlePlacement.id,
      articleId: schema.ArticlePlacement.articleId,
      parentId: schema.ArticlePlacement.parentId,
      knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId,
    })
    .from(schema.ArticlePlacement)
    .where(
      and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        inArray(schema.ArticlePlacement.knowledgeBaseId, kbIds)
      )
    )

  const childrenByParent = new Map<string, typeof placements>()
  const placementsByArticle = new Map<string, typeof placements>()
  for (const p of placements) {
    if (p.parentId) {
      const arr = childrenByParent.get(p.parentId) ?? []
      arr.push(p)
      childrenByParent.set(p.parentId, arr)
    }
    const byArticle = placementsByArticle.get(p.articleId) ?? []
    byArticle.push(p)
    placementsByArticle.set(p.articleId, byArticle)
  }

  const collectSubtree = (articleIds: readonly string[]): Set<string> => {
    const out = new Set<string>()
    const queue: string[] = []
    for (const articleId of articleIds) {
      for (const p of placementsByArticle.get(articleId) ?? []) queue.push(p.id)
      out.add(articleId)
    }
    const seenPlacements = new Set<string>(queue)
    while (queue.length > 0) {
      const placementId = queue.pop() as string
      for (const child of childrenByParent.get(placementId) ?? []) {
        out.add(child.articleId)
        if (seenPlacements.has(child.id)) continue
        seenPlacements.add(child.id)
        queue.push(child.id)
      }
    }
    return out
  }

  const articleIds = new Set<string>(scope.articleIds)
  for (const id of collectSubtree(scope.articleTreeIds)) articleIds.add(id)
  const excludedArticleIds = collectSubtree(scope.excludedArticleIds)
  for (const id of excludedArticleIds) articleIds.delete(id)

  const kbIdsWithScopedArticles = new Set<string>()
  for (const articleId of articleIds) {
    for (const p of placementsByArticle.get(articleId) ?? []) {
      kbIdsWithScopedArticles.add(p.knowledgeBaseId)
    }
  }

  return { articleIds, excludedArticleIds, kbIdsWithScopedArticles }
}

/**
 * Datasets + owned KB ids of the knowledge sources linked into `kbIds`. Mirrors
 * the federation branch of `collectManagedDatasetIds` — search stays embed-once,
 * so a scoped KB has to bring its linked sources' datasets along.
 */
async function resolveFederatedKbs(
  db: Database,
  organizationId: string,
  kbIds: ReadonlySet<string>
): Promise<{ datasetIds: Set<string>; ownedKbIdsByParent: Map<string, string[]> }> {
  const result = { datasetIds: new Set<string>(), ownedKbIdsByParent: new Map<string, string[]>() }
  if (kbIds.size === 0) return result

  const linkRows = await db
    .selectDistinct({
      knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId,
      sourceId: schema.ArticlePlacement.linkedFromSourceId,
    })
    .from(schema.ArticlePlacement)
    .where(
      and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        inArray(schema.ArticlePlacement.knowledgeBaseId, [...kbIds]),
        isNotNull(schema.ArticlePlacement.linkedFromSourceId)
      )
    )
  if (linkRows.length === 0) return result

  const sourceIds = [
    ...new Set(linkRows.map((r) => r.sourceId).filter((id): id is string => Boolean(id))),
  ]
  const sources = await db
    .select({
      id: schema.KnowledgeSource.id,
      ownedKnowledgeBaseId: schema.KnowledgeSource.ownedKnowledgeBaseId,
    })
    .from(schema.KnowledgeSource)
    .where(
      and(
        inArray(schema.KnowledgeSource.id, sourceIds),
        eq(schema.KnowledgeSource.organizationId, organizationId)
      )
    )

  const ownedKbIdBySource = new Map(sources.map((s) => [s.id, s.ownedKnowledgeBaseId]))
  for (const row of linkRows) {
    const ownedKbId = row.sourceId ? ownedKbIdBySource.get(row.sourceId) : undefined
    if (!ownedKbId) continue
    const arr = result.ownedKbIdsByParent.get(row.knowledgeBaseId) ?? []
    arr.push(ownedKbId)
    result.ownedKbIdsByParent.set(row.knowledgeBaseId, arr)
  }

  const ownedKbIds = [...new Set(sources.map((s) => s.ownedKnowledgeBaseId).filter(Boolean))]
  if (ownedKbIds.length === 0) return result

  const ownedKbs = await db
    .select({ datasetId: schema.KnowledgeBase.datasetId })
    .from(schema.KnowledgeBase)
    .where(inArray(schema.KnowledgeBase.id, ownedKbIds))
  for (const kb of ownedKbs) {
    if (kb.datasetId) result.datasetIds.add(kb.datasetId)
  }

  return result
}
