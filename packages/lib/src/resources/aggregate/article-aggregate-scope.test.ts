// packages/lib/src/resources/aggregate/article-aggregate-scope.test.ts
//
// Plan v3/06 P3 (§3.1 R9, §5.6, §10.3 item 8). `article` is the only system
// aggregate source, and its WHERE was `organizationId = $1` and nothing else —
// so a dashboard widget counted articles in knowledge bases the viewer cannot
// open.
//
// 🔴 **The cache key is the deliverable, not a detail.** The aggregate result
// cache is documented as user-agnostic and is keyed without a viewer. Narrowing
// the SQL without forking the key serves the first caller's numbers to every
// other member in the org, in BOTH directions — a narrow viewer shown a wide
// viewer's totals, and a wide viewer shown a narrow one's. So the assertions
// that matter here are on **key strings**, which are real values: a built
// Drizzle predicate is unassertable under this package's Vitest config
// (columns are `{}`), and `expect(sql).toContain(...)` on one passes vacuously.
//
// The WHERE half is asserted through the raw text `articleVisibilitySql`
// contributes (`sql.raw` / template chunks survive the `{}` columns), never
// through a column reference. The real-column proof is the dev-postgres check
// in the plan's §9 banner.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  knowledgeBases: [] as Array<{ id: string; kind: string }>,
  aggCacheReads: [] as string[],
  aggCacheWrites: [] as string[],
}))

// Partial mock — a full replacement of `../../cache` breaks at collection time
// as the import graph grows (matching every sibling aggregate test).
vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedKnowledgeBases: async () => h.knowledgeBases,
    getCachedResourceFields: async () => FIELDS,
    getAggregateCache: () => ({
      read: async (key: string) => {
        h.aggCacheReads.push(key)
        return null
      },
      write: async (key: string) => {
        h.aggCacheWrites.push(key)
      },
    }),
  }
})

import type { Database } from '@auxx/database'
import { viewableKnowledgeBaseIds } from '../../permissions/capabilities/article-visibility-scope'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { BaseType } from '../../workflow-engine/core/types'
import type { ResourceField } from '../registry/field-types'
import { runAggregate, runKpi } from './run-aggregate'
import { buildSystemAggregateSql } from './system-aggregate-builder'
import type { AggregateQuery } from './types'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

/** The dev fixture from the plan's §1.2, so the ids match the DB check. */
const STANDARD_KB = 'r7gncj0m9f88home9kp8j1s7'
const OTHER_STANDARD_KB = 'oucloniq2dmfkxkt9h5u5h03'
const SOURCE_KB = 'd9mvw4li82k90ftph4h26n0m'
const LEARNED_KB = 'oixvifyqdgq5r0nz1wr2qsfy'

const FIELDS: ResourceField[] = [
  {
    id: 'cf_article_status_00000001',
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: 'SINGLE_SELECT',
    dbColumn: 'status',
    systemAttribute: 'article_status',
  } as unknown as ResourceField,
]

/**
 * A `CapabilityView` stub exposing only the instance predicates the allow-list
 * fold reads. `'*'` is the SEEDED baseline (`knowledgeBase: Edit` +
 * `baselineAtCreate: false`), not an exotic case.
 */
function view(kbIds: string[] | '*'): CapabilityView {
  const holds = (id: string) => kbIds === '*' || kbIds.includes(id)
  return {
    canViewInstance: (_key: string, id: string) => holds(id),
    canEditInstance: (_key: string, id: string) => holds(id),
    canAdminInstance: () => false,
  } as unknown as CapabilityView
}

function stubDb(): Database {
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: async () => ({ rows: [{ value: 7 }] }) }),
  } as unknown as Database
}

const articleCount: AggregateQuery = {
  source: { kind: 'system', tableId: 'article' },
  metric: { op: 'count' },
  timezone: 'UTC',
}

/** The key `runAggregate` looked the result up under, for one viewer. */
async function aggKeyFor(capabilities: CapabilityView | undefined): Promise<string> {
  h.aggCacheReads.length = 0
  const result = await runAggregate(stubDb(), ORG, 'user_1', articleCount, { capabilities })
  // Asserted so a key comparison can never be between two keys from two runs
  // that both died before building any SQL.
  expect(result.isOk()).toBe(true)
  expect(h.aggCacheReads).toHaveLength(1)
  return h.aggCacheReads[0] as string
}

async function kpiKeyFor(capabilities: CapabilityView | undefined): Promise<string> {
  h.aggCacheReads.length = 0
  const result = await runKpi(stubDb(), ORG, 'user_1', { base: articleCount }, { capabilities })
  expect(result.isOk()).toBe(true)
  expect(h.aggCacheReads).toHaveLength(1)
  return h.aggCacheReads[0] as string
}

beforeEach(() => {
  h.knowledgeBases = [
    { id: STANDARD_KB, kind: 'standard' },
    { id: OTHER_STANDARD_KB, kind: 'standard' },
    { id: SOURCE_KB, kind: 'source' },
    { id: LEARNED_KB, kind: 'learned' },
  ]
  h.aggCacheReads.length = 0
  h.aggCacheWrites.length = 0
})

describe('the aggregate result cache learns the viewer — §10.3 item 8', () => {
  it('gives two viewers with different KB access DIFFERENT keys', async () => {
    // The concrete repro: the dev Member holds only `r7gncj0m9f88home9kp8j1s7`
    // while an unrestricted member holds every KB. Their counts differ, so a
    // shared entry would hand one of them the other's number.
    const narrow = await aggKeyFor(view([STANDARD_KB]))
    const wide = await aggKeyFor(view('*'))

    expect(narrow).not.toBe(wide)
    // Both still carry the org prefix that per-org flushing depends on.
    expect(narrow.startsWith(`${ORG}:`)).toBe(true)
    expect(wide.startsWith(`${ORG}:`)).toBe(true)
  })

  it('forks the KPI key the same way — `runKpi` shares the scope resolution', async () => {
    // A KPI is the worse leak of the two: one big number, nothing to eyeball.
    expect(await kpiKeyFor(view([STANDARD_KB]))).not.toBe(await kpiKeyFor(view('*')))
  })

  it('keeps ONE entry for two viewers with identical access — the hit rate survives', async () => {
    // Per §8.0 this is the common case, and it is why the fingerprint is of an
    // access SHAPE rather than of a user id.
    expect(await aggKeyFor(view([STANDARD_KB, OTHER_STANDARD_KB]))).toBe(
      await aggKeyFor(view([OTHER_STANDARD_KB, STANDARD_KB]))
    )
  })

  it('separates a viewer who sees NOTHING from one who sees everything', async () => {
    // `kb:none` must never collide with a wide viewer: a zero served to a wide
    // viewer is silent data loss, and the reverse is the leak.
    const none = await aggKeyFor(view([]))

    expect(none).not.toBe(await aggKeyFor(view('*')))
    expect(none).not.toBe(await aggKeyFor(view([STANDARD_KB])))
  })

  it('separates a headless caller from a member who holds every KB', async () => {
    // 🔴 The correction to §8.0. `capabilities: undefined` ⇒ unrestricted, but a
    // member holding every KB is NOT unrestricted: `kind: 'source'` KBs are
    // excluded for everyone, OWNER included. The two compute different numbers,
    // so they must not share an entry — and this is exactly the assertion that
    // fails if someone adds a "this viewer sees everything ⇒ skip it" shortcut.
    expect(await aggKeyFor(undefined)).not.toBe(await aggKeyFor(view('*')))
  })

  it('does NOT fork a non-article source on KB access', async () => {
    const entityQuery: AggregateQuery = {
      source: { kind: 'entity', entityDefinitionId: 'contact' },
      metric: { op: 'count' },
      timezone: 'UTC',
    }
    const keyFor = async (capabilities: CapabilityView) => {
      h.aggCacheReads.length = 0
      await runAggregate(stubDb(), ORG, 'user_1', entityQuery, { capabilities })
      return h.aggCacheReads[0] as string
    }

    // Contacts carry no KB policy; forking their key on KB grants would shred
    // the hit rate for every dashboard in the org and protect nothing.
    expect(await keyFor(view([STANDARD_KB]))).toBe(await keyFor(view('*')))
  })

  it('writes the result under the SAME key it read — no fork between read and write', async () => {
    // A read keyed per scope and a write keyed without one would repopulate the
    // shared entry on every miss, i.e. reintroduce the leak through the back
    // door.
    h.aggCacheReads.length = 0
    h.aggCacheWrites.length = 0
    await runAggregate(stubDb(), ORG, 'user_1', articleCount, {
      capabilities: view([STANDARD_KB]),
    })

    expect(h.aggCacheWrites).toEqual(h.aggCacheReads)
  })
})

/**
 * Every literal string Drizzle would emit for `node`, params included. Only the
 * `sql.raw` / template-literal text is asserted on below — never a column, which
 * is `{}` here and would make the assertion vacuous.
 */
function sqlText(node: unknown): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(sqlText).join('')
  if (typeof node !== 'object') return ''
  const obj = node as { queryChunks?: unknown; value?: unknown }
  if (Array.isArray(obj.queryChunks)) return obj.queryChunks.map(sqlText).join('')
  if (obj.value !== undefined) return sqlText(obj.value)
  return ''
}

describe('buildSystemAggregateSql ANDs the article predicate', () => {
  const build = (viewableKbIds: string[] | 'all') =>
    sqlText(
      buildSystemAggregateSql({
        organizationId: ORG,
        tableId: 'article',
        metric: { op: 'count' },
        viewableKbIds,
        timezone: 'UTC',
        fetchCap: 100,
      })
    )

  it('adds nothing for a headless caller', () => {
    const text = build('all')

    expect(text).toContain('FROM')
    expect(text).not.toContain('ArticlePlacement')
  })

  it('correlates ArticlePlacement and binds the viewer ids when scoped', () => {
    const text = build([STANDARD_KB])

    expect(text).toContain('ArticlePlacement')
    expect(text).toContain(`{${STANDARD_KB}}`)
    expect(text).not.toContain(OTHER_STANDARD_KB)
  })

  it('still applies for a viewer holding EVERY KB, and drops the source KB', async () => {
    // 🔴 No "wide viewer ⇒ skip the predicate" shortcut. `kind: 'source'` KBs
    // are excluded unconditionally, so skipping it here would re-admit exactly
    // the source-only rows §6.1 removes — for everyone, OWNER included.
    const ids = await viewableKnowledgeBaseIds(ORG, view('*'))
    expect(ids).not.toBe('all')
    const text = build(ids as string[])

    expect(text).toContain('ArticlePlacement')
    expect(text).toContain(STANDARD_KB)
    expect(text).toContain(LEARNED_KB)
    expect(text).not.toContain(SOURCE_KB)
  })

  it('renders an empty allow-list as a match-nothing array, not as "no filter"', () => {
    // A viewer with no viewable KB must get 0, never the org total. `= ANY('{}')`
    // matches nothing, which is the fail-closed direction.
    const text = build([])

    expect(text).toContain('ArticlePlacement')
    expect(text).toContain('{}')
  })
})
