// packages/lib/src/datasets/resolve-knowledge-targets.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { ResolvedKnowledgeScope } from '../agents/resolve-knowledge-scope'
import { AuxxError } from '../errors'
import type { CapabilityView } from '../permissions/capabilities/capability-view'

const logger = createScopedLogger('datasets/resolve-knowledge-targets')

/**
 * One requested search target. A caller states *what* it wants to search; this
 * module answers *which dataset ids* that resolves to for the acting principal.
 *
 * - `dataset` / `kb` — an explicit id. `kb` federates (see
 *   {@link collectManagedDatasetIds}).
 * - `all-managed` / `all-rag` — the unscoped "everything of this flavour"
 *   requests, which is how `search_knowledge`'s `source: kb | rag | both`
 *   translates when the caller names no id.
 */
export type KnowledgeTarget =
  | { kind: 'dataset'; datasetId: string }
  | { kind: 'kb'; knowledgeBaseId: string }
  | { kind: 'all-managed' }
  | { kind: 'all-rag' }

/** The `kb | rag | both` vocabulary `search_knowledge` exposes to the model. */
export type KnowledgeSource = 'kb' | 'rag' | 'both'

/**
 * Translate a `source` + optional ids into targets.
 *
 * Lives here rather than at the tool's call site because it is shared
 * vocabulary: `scripts/debug-search-knowledge.ts` exists to reproduce the
 * tool's resolution exactly, and it previously drifted by re-implementing it.
 *
 * `both` is the union of the two single-source translations, which is what the
 * previous inline `Promise.all` over the kb and rag branches produced.
 */
export function knowledgeTargetsForSource(
  source: KnowledgeSource,
  knowledgeBaseId?: string,
  requestedDatasetIds?: readonly string[]
): KnowledgeTarget[] {
  const kb: KnowledgeTarget[] = knowledgeBaseId
    ? [{ kind: 'kb', knowledgeBaseId }]
    : [{ kind: 'all-managed' }]
  const rag: KnowledgeTarget[] =
    requestedDatasetIds && requestedDatasetIds.length > 0
      ? requestedDatasetIds.map((datasetId) => ({ kind: 'dataset', datasetId }))
      : [{ kind: 'all-rag' }]

  if (source === 'kb') return kb
  if (source === 'rag') return rag
  return [...kb, ...rag]
}

export interface ResolveKnowledgeTargetsArgs {
  organizationId: string
  targets: readonly KnowledgeTarget[]
  /**
   * Per-instance read gate for the acting principal (capability layer v2 §3.3,
   * doc-11 "Read = use in search/agents").
   *
   * 🔴 **REQUIRED, and that is the point.** The extracted original read
   * `capabilities?: CapabilityView` and short-circuited to "return everything"
   * when absent — i.e. a caller that forgot the field got an *unfiltered*
   * retrieval set. That is fail-OPEN on a payload that gets fed straight into a
   * model prompt, which is the same class of leak that made `renderKbCatalog`'s
   * `kbAccess` a required union (`kb/catalog/render-kb-catalog.ts`).
   *
   * Flipping the short-circuit was not available: `capabilities: undefined` ⇒
   * unrestricted is a load-bearing convention for headless callers. So the type
   * forces the distinction instead — **"no viewer"** (`'unrestricted'`, a
   * deliberate, greppable choice) versus **"a viewer, who may see nothing"**
   * (a `CapabilityView` that may deny every id, yielding an empty set).
   */
  capabilities: CapabilityView | 'unrestricted'
  /**
   * Visitor clamp — restrict managed datasets to PUBLIC knowledge bases and
   * drop RAG entirely. An untrusted external caller must never reach an
   * INTERNAL KB or any RAG dataset, full stop.
   *
   * The RAG drop is enforced *here* rather than trusting each caller to omit
   * its RAG targets. Today no caller can reach that combination (the tool
   * forces `source: 'kb'` on a visitor turn), so this changes no behaviour —
   * it just means a future caller cannot reintroduce the hole by translating
   * its targets wrong.
   */
  publicOnly?: boolean
  /**
   * Agent retrieval scope (permissions v2 §1.2/1.3). Intersected with the
   * collected ids — narrows, never adds. `null` ⇒ unrestricted; pass it
   * explicitly so the call site reads as a decision rather than an omission.
   */
  knowledgeScope: ResolvedKnowledgeScope | null
}

/**
 * Resolve search targets to the concrete, access-filtered dataset id set.
 *
 * `SearchService.search` has **no ACL of its own** — `getAccessibleDatasets`
 * filters on `organizationId` and `status = 'ACTIVE'` only, and an empty
 * `datasetIds` makes it search *every* active dataset in the org, managed KB
 * datasets included. This function is therefore the access boundary for every
 * knowledge search, and its callers must treat an empty result as "search
 * nothing", never as "search everything".
 *
 * Narrowing order is load-bearing and preserved from the original:
 * collect → in-memory `knowledgeScope` intersection (no I/O, so a scope that
 * narrows to nothing skips the capability query entirely) → capability
 * instance-access filter.
 *
 * An empty result is a normal empty search, never a 403.
 */
export async function resolveKnowledgeDatasetIds(
  db: Database,
  args: ResolveKnowledgeTargetsArgs
): Promise<Result<string[], Error>> {
  const { organizationId, targets, capabilities, publicOnly, knowledgeScope } = args

  try {
    const collected = await collectDatasetIds(db, organizationId, targets, publicOnly)

    // Cheap in-memory intersection, no I/O — runs before the capability
    // filter's extra KB query so a scope that already narrows to nothing skips
    // it entirely. Absent scope is a no-op pass-through.
    const scoped = knowledgeScope
      ? collected.filter((id) => knowledgeScope.datasetIds.has(id))
      : collected

    return ok(await filterAccessibleDatasetIds(db, organizationId, scoped, capabilities))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to resolve knowledge dataset ids', { error, organizationId })
    return err(new AuxxError('Failed to resolve knowledge dataset ids'))
  }
}

async function collectDatasetIds(
  db: Database,
  organizationId: string,
  targets: readonly KnowledgeTarget[],
  publicOnly?: boolean
): Promise<string[]> {
  const kbIds: string[] = []
  const datasetIds: string[] = []
  let wantsAllManaged = false
  let wantsAllRag = false

  for (const target of targets) {
    switch (target.kind) {
      case 'kb':
        kbIds.push(target.knowledgeBaseId)
        break
      case 'dataset':
        datasetIds.push(target.datasetId)
        break
      case 'all-managed':
        wantsAllManaged = true
        break
      case 'all-rag':
        wantsAllRag = true
        break
      default: {
        const _exhaustive: never = target
        return _exhaustive
      }
    }
  }

  // Visitor clamp: RAG datasets are internal uploads with no visibility tier,
  // so they are unreachable on a public turn regardless of what was requested.
  if (publicOnly) {
    datasetIds.length = 0
    wantsAllRag = false
  }

  const [managed, rag] = await Promise.all([
    collectManagedIds(db, organizationId, kbIds, wantsAllManaged, publicOnly),
    collectRagIds(db, organizationId, datasetIds, wantsAllRag),
  ])

  return [...new Set([...managed, ...rag])]
}

async function collectManagedIds(
  db: Database,
  organizationId: string,
  knowledgeBaseIds: readonly string[],
  wantsAllManaged: boolean,
  publicOnly?: boolean
): Promise<string[]> {
  // "All managed" subsumes any per-KB request, so resolve it alone and skip the
  // per-KB federation queries entirely.
  if (wantsAllManaged) {
    return collectManagedDatasetIds(db, organizationId, undefined, publicOnly)
  }
  if (knowledgeBaseIds.length === 0) return []

  const perKb = await Promise.all(
    knowledgeBaseIds.map((knowledgeBaseId) =>
      collectManagedDatasetIds(db, organizationId, knowledgeBaseId, publicOnly)
    )
  )
  return perKb.flat()
}

/**
 * Standalone RAG datasets. `isManaged = false` is preserved from the original
 * and is not incidental: it is what stops a caller from reaching a KB's hidden
 * managed dataset by passing its id as a plain `dataset` target.
 */
async function collectRagIds(
  db: Database,
  organizationId: string,
  datasetIds: readonly string[],
  wantsAllRag: boolean
): Promise<string[]> {
  if (!wantsAllRag && datasetIds.length === 0) return []

  const rows = await db
    .select({ id: schema.Dataset.id })
    .from(schema.Dataset)
    .where(
      and(
        eq(schema.Dataset.organizationId, organizationId),
        eq(schema.Dataset.isManaged, false),
        wantsAllRag ? undefined : inArray(schema.Dataset.id, [...datasetIds])
      )
    )
  return rows.map((r) => r.id)
}

/**
 * Instance-access read gate for the searchable set. Every branch above funnels
 * through here, so a dataset the principal can't view — or a managed dataset
 * whose backing KB the principal can't view — never reaches `SearchService`.
 *
 * A KB-backed dataset is governed by its **KB** instance grant (that's the
 * container an admin actually shares); only standalone RAG datasets fall back
 * to the `dataset` key.
 */
async function filterAccessibleDatasetIds(
  db: Database,
  organizationId: string,
  datasetIds: string[],
  capabilities: CapabilityView | 'unrestricted'
): Promise<string[]> {
  if (capabilities === 'unrestricted' || datasetIds.length === 0) return datasetIds

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

/**
 * Datasets backing knowledge bases.
 *
 * With a `knowledgeBaseId`, **federates two ways**, because a `Document` lives
 * in its article's *home* KB's dataset — not in the dataset of every KB the
 * article is placed into:
 *
 *  1. **Home-KB federation** — every article placed in this KB contributes its
 *     home KB's dataset. This is what makes a KB-scoped search find a
 *     hand-authored article linked in from another KB (KB guide §2's documented
 *     "search federation gap": such a placement has `linkedFromSourceId = null`,
 *     so arm 2 never saw it).
 *  2. **Source federation** — a source linked into this KB embeds its content
 *     once in its own hidden KB's dataset.
 *
 * Arm 1 very likely *subsumes* arm 2 (a source's articles should have the
 * source-owned KB as their home), but that is unverified against real
 * source-linked data, so both run and their results union. If subsumption is
 * ever confirmed, arm 2 is the one to delete. Search stays embed-once either
 * way — the union is over datasets, and duplicates collapse.
 */
async function collectManagedDatasetIds(
  db: Database,
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
          // Visitor clamp — an INTERNAL KB id resolves to no datasets.
          publicOnly ? eq(schema.KnowledgeBase.visibility, 'PUBLIC') : undefined
        )
      )
      .limit(1)
    if (!kb) return []
    const datasetIds = kb.datasetId ? [kb.datasetId] : []

    const [homeRows, linkRows] = await Promise.all([
      // Arm 1 — home KBs of every article placed here. `homeKnowledgeBaseId` is
      // notNull, so there is no null arm. This KB's own id comes back for
      // natively-authored articles; harmless, its dataset is already in the set.
      db
        .selectDistinct({ homeKnowledgeBaseId: schema.Article.homeKnowledgeBaseId })
        .from(schema.ArticlePlacement)
        .innerJoin(schema.Article, eq(schema.Article.id, schema.ArticlePlacement.articleId))
        .where(
          and(
            eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
            eq(schema.ArticlePlacement.organizationId, organizationId)
          )
        ),
      // Arm 2 — sources linked into this KB.
      db
        .selectDistinct({ sourceId: schema.ArticlePlacement.linkedFromSourceId })
        .from(schema.ArticlePlacement)
        .where(
          and(
            eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
            eq(schema.ArticlePlacement.organizationId, organizationId),
            isNotNull(schema.ArticlePlacement.linkedFromSourceId)
          )
        ),
    ])

    const federatedKbIds = new Set(
      homeRows.map((r) => r.homeKnowledgeBaseId).filter((id): id is string => Boolean(id))
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
      for (const s of sources) {
        if (s.ownedKnowledgeBaseId) federatedKbIds.add(s.ownedKnowledgeBaseId)
      }
    }

    // The target KB's own dataset is already collected above.
    federatedKbIds.delete(knowledgeBaseId)

    if (federatedKbIds.size > 0) {
      const federatedKbs = await db
        .select({ datasetId: schema.KnowledgeBase.datasetId })
        .from(schema.KnowledgeBase)
        .where(inArray(schema.KnowledgeBase.id, [...federatedKbIds]))
      datasetIds.push(
        ...federatedKbs.map((k) => k.datasetId).filter((id): id is string => Boolean(id))
      )
    }
    return [...new Set(datasetIds)]
  }
  // Visitor clamp — restrict to datasets backing PUBLIC knowledge bases.
  // Internal callers get every managed dataset.
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
