// packages/lib/src/datasets/__tests__/resolve-knowledge-targets.test.ts
//
// Scope note: the WHERE predicates in this module moved verbatim out of
// `search-knowledge.ts` and are exercised end-to-end by that tool's existing
// tests (the extraction's oracle). A fake `db` cannot evaluate drizzle
// predicates, so simulating `isManaged = false` here would only test the fake.
//
// What IS new in this module, and what these tests cover:
//  - target routing (which tables a target kind reaches, and which it skips)
//  - `all-managed` subsuming per-KB requests
//  - the `publicOnly` RAG drop, enforced here rather than trusted to callers
//  - the in-memory `knowledgeScope` intersection, and that it runs BEFORE the
//    capability query
//  - capability keying: KB-backed datasets on the `kb` grant, standalone on
//    `dataset` — and that `'unrestricted'` issues no extra query
//  - empty is `ok([])`, never `err`

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import type { ResolvedKnowledgeScope } from '../../agents/resolve-knowledge-scope'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { knowledgeTargetsForSource, resolveKnowledgeDatasetIds } from '../resolve-knowledge-targets'

const KB_ID = 'kb_1'
const KB_DATASET = 'ds_kb_1'
const OWNED_KB_ID = 'kb_source_owned'
const OWNED_KB_DATASET = 'ds_kb_source_owned'
const RAG_DATASET = 'ds_rag_1'
const SOURCE_ID = 'src_1'
const ORG = 'org_1'

interface FakeRows {
  /** Rows for `select({ id }).from(Dataset)` — the "all managed"/RAG lists. */
  datasets?: string[]
  /** `select({ datasetId }).from(KnowledgeBase)` — single KB, owned KB, or public list. */
  kbDatasetIds?: string[]
  /** `selectDistinct({ sourceId }).from(ArticlePlacement)`. */
  placementSourceIds?: string[]
  /** `selectDistinct({ homeKnowledgeBaseId }).from(ArticlePlacement).innerJoin(Article)`. */
  placementHomeKbIds?: string[]
  /** `select({ ownedKnowledgeBaseId }).from(KnowledgeSource)`. */
  ownedKbIds?: string[]
  /** `select({ id, datasetId }).from(KnowledgeBase)` — the access-filter map. */
  kbMap?: Array<{ id: string; datasetId: string | null }>
}

/**
 * Fake drizzle handle dispatching on the table reference (`src/test/setup.ts`
 * memoizes the schema proxy, so `table === schema.X` holds) plus the selected
 * column set. Records every query so a test can assert which roundtrips ran.
 */
function makeDb(rows: FakeRows, log: string[] = []) {
  const build = (cols: Record<string, unknown> | undefined, distinct: boolean) => ({
    from: (table: unknown) => {
      const has = (k: string) => Boolean(cols && k in cols)
      let tag: string
      let result: unknown[]

      if (table === schema.ArticlePlacement) {
        // Two distinct reads hit this table — the home-KB join (arm 1) and the
        // source-link scan (arm 2) — told apart by the selected column.
        if (has('homeKnowledgeBaseId')) {
          tag = 'placement-home-kbs'
          result = (rows.placementHomeKbIds ?? []).map((homeKnowledgeBaseId) => ({
            homeKnowledgeBaseId,
          }))
        } else {
          tag = 'placements'
          result = (rows.placementSourceIds ?? []).map((sourceId) => ({ sourceId }))
        }
      } else if (table === schema.KnowledgeSource) {
        tag = 'sources'
        result = (rows.ownedKbIds ?? []).map((ownedKnowledgeBaseId) => ({ ownedKnowledgeBaseId }))
      } else if (table === schema.Dataset) {
        tag = 'datasets'
        result = (rows.datasets ?? []).map((id) => ({ id }))
      } else if (has('id') && has('datasetId')) {
        tag = 'kb-map'
        result = rows.kbMap ?? []
      } else {
        tag = 'kb-datasets'
        result = (rows.kbDatasetIds ?? []).map((datasetId) => ({ datasetId }))
      }

      log.push(distinct ? `${tag}:distinct` : tag)
      const where = () => {
        const p = Promise.resolve(result) as Promise<unknown[]> & {
          limit: () => Promise<unknown[]>
        }
        p.limit = () => Promise.resolve(result.slice(0, 1))
        return p
      }
      // `innerJoin` returns the same builder — the fake's rows already stand in
      // for the joined shape.
      const node: { where: typeof where; innerJoin: () => typeof node } = {
        where,
        innerJoin: () => node,
      }
      return node
    },
  })

  return {
    select: (cols?: Record<string, unknown>) => build(cols, false),
    selectDistinct: (cols?: Record<string, unknown>) => build(cols, true),
  } as never
}

/** A `CapabilityView` that answers only `canViewInstance`; nothing else is reached. */
function capsAllowing(allow: (key: string, id: string) => boolean): CapabilityView {
  return {
    canViewInstance: (key: string, instanceId: string) => allow(key, instanceId),
  } as unknown as CapabilityView
}

function scope(datasetIds: string[]): ResolvedKnowledgeScope {
  return {
    datasetIds: new Set(datasetIds),
    fullKbIds: new Set<string>(),
    articleIds: new Set<string>(),
    excludedArticleIds: new Set<string>(),
  } as unknown as ResolvedKnowledgeScope
}

async function resolve(rows: FakeRows, args: Parameters<typeof resolveKnowledgeDatasetIds>[1]) {
  const log: string[] = []
  const result = await resolveKnowledgeDatasetIds(makeDb(rows, log), args)
  if (result.isErr()) throw result.error
  return { ids: result.value, log }
}

describe('knowledgeTargetsForSource', () => {
  it("maps 'kb' with an id to a single kb target, without one to all-managed", () => {
    expect(knowledgeTargetsForSource('kb', KB_ID)).toEqual([{ kind: 'kb', knowledgeBaseId: KB_ID }])
    expect(knowledgeTargetsForSource('kb')).toEqual([{ kind: 'all-managed' }])
  })

  it("maps 'rag' with ids to dataset targets, without them to all-rag", () => {
    expect(knowledgeTargetsForSource('rag', undefined, ['a', 'b'])).toEqual([
      { kind: 'dataset', datasetId: 'a' },
      { kind: 'dataset', datasetId: 'b' },
    ])
    expect(knowledgeTargetsForSource('rag')).toEqual([{ kind: 'all-rag' }])
  })

  it("'both' is the union of the two single-source translations", () => {
    expect(knowledgeTargetsForSource('both', KB_ID, ['a'])).toEqual([
      { kind: 'kb', knowledgeBaseId: KB_ID },
      { kind: 'dataset', datasetId: 'a' },
    ])
  })
})

describe('resolveKnowledgeDatasetIds — target routing', () => {
  it('a kb target federates through placements → sources → owned KB datasets', async () => {
    const { ids, log } = await resolve(
      {
        kbDatasetIds: [KB_DATASET, OWNED_KB_DATASET],
        placementSourceIds: [SOURCE_ID],
        ownedKbIds: [OWNED_KB_ID],
      },
      {
        organizationId: ORG,
        targets: [{ kind: 'kb', knowledgeBaseId: KB_ID }],
        capabilities: 'unrestricted',
        knowledgeScope: null,
      }
    )

    // KB row (.limit(1) → first id), then the federation chain, then the owned
    // KB's dataset — deduped into one set.
    expect(log).toContain('placements:distinct')
    expect(log).toContain('sources')
    expect(ids).toEqual([KB_DATASET, OWNED_KB_DATASET])
  })

  it('federates to the HOME KB of a hand-authored article linked in (§5c gap)', async () => {
    // KB-B is the target. An article authored in KB-A is *placed* into KB-B
    // with linkedFromSourceId = null, so arm 2 sees nothing — but its
    // embeddings live in KB-A's dataset, which arm 1 must pull in.
    const { ids, log } = await resolve(
      {
        kbDatasetIds: [KB_DATASET, 'ds_kb_a'],
        placementHomeKbIds: ['kb_a'],
        placementSourceIds: [],
      },
      {
        organizationId: ORG,
        targets: [{ kind: 'kb', knowledgeBaseId: KB_ID }],
        capabilities: 'unrestricted',
        knowledgeScope: null,
      }
    )
    expect(log).toContain('placement-home-kbs:distinct')
    expect(log).not.toContain('sources') // no source chain involved at all
    expect(ids).toEqual([KB_DATASET, 'ds_kb_a'])
  })

  it('does not re-query the target KB when every article is natively authored', async () => {
    // Arm 1 returns the target KB's own id; its dataset is already collected,
    // so there must be no second KnowledgeBase lookup for it.
    const { ids, log } = await resolve(
      {
        kbDatasetIds: [KB_DATASET],
        placementHomeKbIds: [KB_ID],
        placementSourceIds: [],
      },
      {
        organizationId: ORG,
        targets: [{ kind: 'kb', knowledgeBaseId: KB_ID }],
        capabilities: 'unrestricted',
        knowledgeScope: null,
      }
    )
    expect(ids).toEqual([KB_DATASET])
    // exactly one kb-datasets read: the target KB's own row
    expect(log.filter((q) => q === 'kb-datasets')).toHaveLength(1)
  })

  it('skips the federation queries entirely when a KB has no linked sources', async () => {
    const { log } = await resolve(
      { kbDatasetIds: [KB_DATASET], placementSourceIds: [] },
      {
        organizationId: ORG,
        targets: [{ kind: 'kb', knowledgeBaseId: KB_ID }],
        capabilities: 'unrestricted',
        knowledgeScope: null,
      }
    )
    expect(log).toContain('placements:distinct')
    expect(log).not.toContain('sources')
  })

  it('all-managed subsumes per-KB targets — no federation roundtrips', async () => {
    const { ids, log } = await resolve(
      { datasets: [KB_DATASET, OWNED_KB_DATASET] },
      {
        organizationId: ORG,
        targets: [{ kind: 'all-managed' }, { kind: 'kb', knowledgeBaseId: KB_ID }],
        capabilities: 'unrestricted',
        knowledgeScope: null,
      }
    )
    expect(ids).toEqual([KB_DATASET, OWNED_KB_DATASET])
    expect(log).not.toContain('placements:distinct')
    expect(log).toEqual(['datasets'])
  })

  it('queries nothing at all when there are no targets', async () => {
    const { ids, log } = await resolve(
      {},
      {
        organizationId: ORG,
        targets: [],
        capabilities: 'unrestricted',
        knowledgeScope: null,
      }
    )
    expect(ids).toEqual([])
    expect(log).toEqual([])
  })
})

describe('resolveKnowledgeDatasetIds — visitor clamp', () => {
  it('drops RAG targets under publicOnly instead of trusting the caller', async () => {
    const { ids, log } = await resolve(
      { kbDatasetIds: [KB_DATASET], placementSourceIds: [] },
      {
        organizationId: ORG,
        targets: [
          { kind: 'kb', knowledgeBaseId: KB_ID },
          { kind: 'dataset', datasetId: RAG_DATASET },
          { kind: 'all-rag' },
        ],
        capabilities: 'unrestricted',
        publicOnly: true,
        knowledgeScope: null,
      }
    )
    expect(ids).toEqual([KB_DATASET])
    // The Dataset table is never reached at all — the drop is structural.
    expect(log).not.toContain('datasets')
  })
})

describe('resolveKnowledgeDatasetIds — knowledgeScope', () => {
  it('intersects the collected set, and narrows to nothing without the capability query', async () => {
    const { ids, log } = await resolve(
      { datasets: [KB_DATASET, RAG_DATASET] },
      {
        organizationId: ORG,
        targets: [{ kind: 'all-managed' }],
        capabilities: capsAllowing(() => true),
        knowledgeScope: scope(['ds_unrelated']),
      }
    )
    expect(ids).toEqual([])
    // Empty after the in-memory intersection ⇒ the kb-map roundtrip is skipped.
    expect(log).not.toContain('kb-map')
  })

  it('keeps only the datasets the scope names', async () => {
    const { ids } = await resolve(
      { datasets: [KB_DATASET, RAG_DATASET] },
      {
        organizationId: ORG,
        targets: [{ kind: 'all-managed' }],
        capabilities: 'unrestricted',
        knowledgeScope: scope([RAG_DATASET]),
      }
    )
    expect(ids).toEqual([RAG_DATASET])
  })
})

describe('resolveKnowledgeDatasetIds — capability filter', () => {
  const rows: FakeRows = {
    datasets: [KB_DATASET, RAG_DATASET],
    kbMap: [{ id: KB_ID, datasetId: KB_DATASET }],
  }

  it('governs a KB-backed dataset by its kb grant', async () => {
    const { ids } = await resolve(rows, {
      organizationId: ORG,
      targets: [{ kind: 'all-managed' }],
      capabilities: capsAllowing((key, id) => !(key === 'kb' && id === KB_ID)),
      knowledgeScope: null,
    })
    expect(ids).toEqual([RAG_DATASET])
  })

  it('governs a standalone dataset by its dataset grant', async () => {
    const { ids } = await resolve(rows, {
      organizationId: ORG,
      targets: [{ kind: 'all-managed' }],
      capabilities: capsAllowing((key, id) => !(key === 'dataset' && id === RAG_DATASET)),
      knowledgeScope: null,
    })
    expect(ids).toEqual([KB_DATASET])
  })

  it('denying everything is an empty success, never an error', async () => {
    const { ids } = await resolve(rows, {
      organizationId: ORG,
      targets: [{ kind: 'all-managed' }],
      capabilities: capsAllowing(() => false),
      knowledgeScope: null,
    })
    expect(ids).toEqual([])
  })

  it("'unrestricted' returns everything and issues no access query", async () => {
    const { ids, log } = await resolve(rows, {
      organizationId: ORG,
      targets: [{ kind: 'all-managed' }],
      capabilities: 'unrestricted',
      knowledgeScope: null,
    })
    expect(ids).toEqual([KB_DATASET, RAG_DATASET])
    expect(log).not.toContain('kb-map')
  })
})

describe('resolveKnowledgeDatasetIds — failure', () => {
  it('returns err rather than throwing when the query layer fails', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.reject(new Error('connection lost')),
        }),
      }),
    } as never

    const result = await resolveKnowledgeDatasetIds(db, {
      organizationId: ORG,
      targets: [{ kind: 'all-managed' }],
      capabilities: 'unrestricted',
      knowledgeScope: null,
    })
    expect(result.isErr()).toBe(true)
  })
})
