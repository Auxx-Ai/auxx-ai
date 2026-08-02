// packages/lib/src/resources/picker/article-admit.test.ts
//
// Plan v3/06 W3 + P2 — the hydration lane (`record.getByIds`) stops handing back
// articles from knowledge bases the member cannot open, and starts stamping the
// `_access` those rows always needed.
//
// `admitSystemRows` gated only keys for which `isInstanceAccessKey` is true, so
// `article` fell through untouched — its own docstring said articles "genuinely
// have no per-row policy in this lane", which is the bug written down. `article`
// is NOT an instance-access key and must never become one (it is not a grant
// target); its policy lives one hop away, on its KB, so it takes its own branch.
//
// P2 is not optional here. `assertRecordRowsEditable`'s rule is
// "missing stamp ⇒ deny", and `canEditEntity('article')` resolves to
// `PermissionKey.recordsEdit` (there is no `article` entry in
// `ENTITY_WRITE_KEYS`) — so shipping the read narrowing WITHOUT the stamp would
// break inline tag editing for every `knowledgeBase: Edit` / `records: None`
// member, which per §8.0 is the COMMON configuration.
//
// The table fetch is stubbed rather than faked through Drizzle: columns are `{}`
// under this package's Vitest config, so `fetchResourcesDirect`'s
// `orderBy`/`requireColumn` cannot run. What is under test is the gate, the
// stamp and the batching — not the SELECT.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeBases = vi.hoisted(() => ({ rows: [] as Array<{ id: string; kind: string }> }))
const placementRows = vi.hoisted(() => ({
  rows: [] as Array<{ articleId: string; knowledgeBaseId: string }>,
  whereCalls: 0,
}))

vi.mock('../../identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../identity')>()
  return { ...actual, getRecordIdentitiesForRecords: vi.fn(async () => new Map()) }
})

// A FULL factory, not `importOriginal` + spread — see the note in
// `list-filtered-mail-lens.test.ts`. `importOriginal` loads the real `cache`
// barrel, whose transitive graph re-enters `article-visibility-scope` *while the
// factory is still running*, so that module binds the REAL
// `getCachedKnowledgeBases` and the override never takes effect. Measured here:
// the test opened a Redis connection and read `undefined`.
vi.mock('../../cache', () => ({
  getCachedKnowledgeBases: vi.fn(async () => knowledgeBases.rows),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getCachedResource: vi.fn(async () => null),
  getCachedResources: vi.fn(async () => []),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

import type { RecordId } from '@auxx/types/resource'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { RecordPickerService } from './record-picker-service'
import type { RecordPickerItem } from './types'

const ORG = 'org_abgwpa1l81reht2zmwrcih'
const USER = 'usr_member00000000000000'

/** The dev fixture (plan §1.2). */
const STANDARD_KB = 'r7gncj0m9f88home9kp8j1s7'
const SOURCE_KB = 'd9mvw4li82k90ftph4h26n0m'
const LEARNED_KB = 'oixvifyqdgq5r0nz1wr2qsfy'

/** Homed in the standard KB. */
const PLAIN_ARTICLE = 'exz17f3i1qu96ik6azu763as'
/** Homed in the SOURCE KB, also placed into the standard KB — the multi-home row. */
const LINKED_ARTICLE = 'gxbz6zn31qsebel4lhqek50y'
/** Source-only. */
const SOURCE_ONLY_ARTICLE = 'ng8kbpmv3nj166lneqv56n1d'
/** AI Memory. */
const LEARNED_ARTICLE = 'em0s33wstyynminepz1zkq8t'

function articleRows(homes: Array<[id: string, homeKnowledgeBaseId: string]>): RecordPickerItem[] {
  return homes.map(([id, homeKnowledgeBaseId]) => ({
    id,
    recordId: `article:${id}` as RecordId,
    displayName: `Article ${id}`,
    data: { id, homeKnowledgeBaseId },
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  })) as RecordPickerItem[]
}

function view(rungs: Record<string, 'read' | 'edit' | 'admin'> | '*'): CapabilityView {
  const at = (id: string) => (rungs === '*' ? 'edit' : rungs[id])
  return {
    canViewEntity: () => true,
    hasRecordGrantsOn: () => false,
    canViewInstance: (_key: string, id: string) => at(id) !== undefined,
    canEditInstance: (_key: string, id: string) => at(id) === 'edit' || at(id) === 'admin',
    canAdminInstance: (_key: string, id: string) => at(id) === 'admin',
  } as unknown as CapabilityView
}

/** A `db` whose only supported query is the batched `ArticlePlacement` read. */
function placementDb() {
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => {
      placementRows.whereCalls += 1
      return chain
    }
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable; faking it needs `then`
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(placementRows.rows).then(res, rej)
    return chain
  })
  return { db: { select } as never, select }
}

async function hydrate(
  ids: string[],
  rows: RecordPickerItem[],
  capabilities: CapabilityView | undefined,
  db = placementDb()
): Promise<{ result: Record<string, RecordPickerItem>; select: ReturnType<typeof vi.fn> }> {
  const service = new RecordPickerService(ORG, USER, db.db, capabilities)
  ;(service as unknown as { fetchResourcesFromDb: unknown }).fetchResourcesFromDb = vi.fn(
    async () => ({ items: rows, nextCursor: null, hasMore: false })
  )
  const result = await service.getResourcesByIds(
    ids.map((id) => `article:${id}` as RecordId) as RecordId[]
  )
  return { result, select: db.select }
}

beforeEach(() => {
  vi.clearAllMocks()
  placementRows.whereCalls = 0
  knowledgeBases.rows = [
    { id: STANDARD_KB, kind: 'standard' },
    { id: SOURCE_KB, kind: 'source' },
    { id: LEARNED_KB, kind: 'learned' },
  ]
  placementRows.rows = [
    { articleId: PLAIN_ARTICLE, knowledgeBaseId: STANDARD_KB },
    { articleId: LINKED_ARTICLE, knowledgeBaseId: SOURCE_KB },
    { articleId: LINKED_ARTICLE, knowledgeBaseId: STANDARD_KB },
    { articleId: SOURCE_ONLY_ARTICLE, knowledgeBaseId: SOURCE_KB },
    { articleId: LEARNED_ARTICLE, knowledgeBaseId: LEARNED_KB },
  ]
})

describe('article hydration — rows drop when their KB is not viewable', () => {
  const batch = [PLAIN_ARTICLE, LINKED_ARTICLE, SOURCE_ONLY_ARTICLE, LEARNED_ARTICLE]
  const rows = () =>
    articleRows([
      [PLAIN_ARTICLE, STANDARD_KB],
      [LINKED_ARTICLE, SOURCE_KB],
      [SOURCE_ONLY_ARTICLE, SOURCE_KB],
      [LEARNED_ARTICLE, LEARNED_KB],
    ])

  it('keeps the standard-KB rows and drops AI Memory for a member holding only the standard KB', async () => {
    const { result } = await hydrate(batch, rows(), view({ [STANDARD_KB]: 'edit' }))

    expect(Object.keys(result).sort()).toEqual(
      [`article:${LINKED_ARTICLE}`, `article:${PLAIN_ARTICLE}`].sort()
    )
  })

  it('ADMITS the source-homed article because it is PLACED in a KB the member holds', async () => {
    // The whole multi-home story. A `homeKnowledgeBaseId`-only predicate would
    // hide a row deliberately published into a KB the member owns.
    const { result } = await hydrate(batch, rows(), view({ [STANDARD_KB]: 'read' }))

    expect(result[`article:${LINKED_ARTICLE}`]).toBeDefined()
  })

  it('drops the source-ONLY article for a member who composes edit on everything', async () => {
    // The seeded baseline (`knowledgeBase: Edit`, `baselineAtCreate: false`)
    // makes `canViewInstance('kb', <source kb>)` true, so the `kind` policy is
    // the only gate. This also holds for OWNER.
    const { result } = await hydrate(batch, rows(), view('*'))

    expect(result[`article:${SOURCE_ONLY_ARTICLE}`]).toBeUndefined()
    expect(result[`article:${LEARNED_ARTICLE}`]).toBeDefined()
  })

  it('is a NON-enumeration: a dropped row leaves no key behind', async () => {
    const { result } = await hydrate(
      [LEARNED_ARTICLE],
      articleRows([[LEARNED_ARTICLE, LEARNED_KB]]),
      view({ [STANDARD_KB]: 'edit' })
    )

    expect(result).toEqual({})
  })

  it('returns nothing, and never queries placements, when no KB is viewable', async () => {
    const { result, select } = await hydrate(batch, rows(), view({}))

    expect(result).toEqual({})
    expect(select).not.toHaveBeenCalled()
  })
})

describe('the `_access` stamp (P2)', () => {
  it('stamps the HOME rung for an ordinary article', async () => {
    // This is what gives a `knowledgeBase: Edit` / `records: None` member back
    // their inline tag editing: `assertRecordRowsEditable` re-judges def-denied
    // rows against `_access`, and "missing stamp ⇒ deny".
    const { result } = await hydrate(
      [PLAIN_ARTICLE],
      articleRows([[PLAIN_ARTICLE, STANDARD_KB]]),
      view({ [STANDARD_KB]: 'edit' })
    )

    expect(result[`article:${PLAIN_ARTICLE}`]?._access).toBe('edit')
  })

  it('is HOME-STRICT: a linked placement cannot raise the stamp (§7.3)', async () => {
    // Readable through the standard KB, but its content is owned by the source
    // KB — which is unopenable — so the row must be read-only.
    const { result } = await hydrate(
      [LINKED_ARTICLE],
      articleRows([[LINKED_ARTICLE, SOURCE_KB]]),
      view('*')
    )

    expect(result[`article:${LINKED_ARTICLE}`]?._access).toBe('read')
  })

  it('carries `admin` through when the member administers the home KB', async () => {
    const { result } = await hydrate(
      [PLAIN_ARTICLE],
      articleRows([[PLAIN_ARTICLE, STANDARD_KB]]),
      view({ [STANDARD_KB]: 'admin' })
    )

    expect(result[`article:${PLAIN_ARTICLE}`]?._access).toBe('admin')
  })
})

describe('the placement read is batched, and skipped for internal callers', () => {
  it('issues exactly ONE ArticlePlacement query for a 100-row batch', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `art${String(i).padStart(21, '0')}`)
    placementRows.rows = ids.map((id) => ({ articleId: id, knowledgeBaseId: STANDARD_KB }))

    const { result, select } = await hydrate(
      ids,
      articleRows(ids.map((id) => [id, STANDARD_KB] as [string, string])),
      view({ [STANDARD_KB]: 'read' })
    )

    // One query, not 100. `getByIds` caps at 100 ids, so a per-row lookup would
    // turn one hydration into a hundred round-trips.
    expect(select).toHaveBeenCalledTimes(1)
    expect(placementRows.whereCalls).toBe(1)
    expect(Object.keys(result)).toHaveLength(100)
  })

  it('an internal caller (`capabilities: undefined`) is not gated and pays no query', async () => {
    const db = placementDb()
    const service = new RecordPickerService(ORG, undefined, db.db)
    ;(service as unknown as { fetchResourcesFromDb: unknown }).fetchResourcesFromDb = vi.fn(
      async () => ({
        items: articleRows([
          [SOURCE_ONLY_ARTICLE, SOURCE_KB],
          [LEARNED_ARTICLE, LEARNED_KB],
        ]),
        nextCursor: null,
        hasMore: false,
      })
    )

    const result = await service.getResourcesByIds([
      `article:${SOURCE_ONLY_ARTICLE}`,
      `article:${LEARNED_ARTICLE}`,
    ] as RecordId[])

    // Headless work (article sync, embedding jobs, apps/kb render, widget API)
    // depends on this convention — §8.2.
    expect(Object.keys(result)).toHaveLength(2)
    expect(db.select).not.toHaveBeenCalled()
  })
})
