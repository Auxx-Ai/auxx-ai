// packages/lib/src/resources/picker/global-union-record-grants.test.ts
//
// Plan v3/03 §5.1, the UNSCOPED arm — `RecordPickerService.search()` called with
// neither `entityDefinitionId` nor `entityDefinitionIds` (the cross-type union
// behind the global record search). Closes the "⚠ KNOWN GAP" that arm carried: a
// def reachable ONLY through per-record grants contributed nothing to it.
//
// The predicate is asserted by OBJECT IDENTITY, never by rendered SQL: under this
// package's Vitest config `@auxx/database`'s `schema` is a Proxy whose columns are
// `undefined`, so a rendered Drizzle predicate is meaningless
// (`project_drizzle_columns_undefined_in_vitest`). The fake `db` instead checks
// whether the exact `SQL` object `recordUnionVisibilitySql` built reached the
// query, and when it did, answers the way a database that applied it would.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const VIEWABLE_DEF = 'edf000000000000000000001' // seen wholesale
const GRANTED_DEF = 'edf000000000000000000002' // reachable only via a row grant
const INVISIBLE_DEF = 'edf000000000000000000003' // neither
const CONTACT_DEF = 'edf000000000000000000004' // mail keyspace — never the record lane

/** The one row of `GRANTED_DEF` actually shared with the member. */
const GRANTED_ROW_ID = 'inst_granted'

const getCachedResources = vi.hoisted(() => vi.fn())
const unionSqlCalls = vi.hoisted(() => [] as unknown[])
/** The SQL object the real builder returned on the most recent call, if any. */
const lastUnionSql = vi.hoisted(() => ({ value: undefined as unknown }))

vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cache')>()
  return { ...actual, getCachedResources }
})

vi.mock('../../resource-access/grantee-resolution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../resource-access/grantee-resolution')>()
  return {
    ...actual,
    resolveResourceAccessGrantees: vi.fn(async () => ({
      userId: 'user_1',
      groupIds: [],
      profileId: null,
    })),
  }
})

// Call-THROUGH wrapper: the real predicate is still what the query carries, so
// these tests fail if the builder stops being reached or stops being embedded.
vi.mock('../../permissions/capabilities/record-visibility-scope', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../permissions/capabilities/record-visibility-scope')>()
  return {
    ...actual,
    recordUnionVisibilitySql: (input: Parameters<typeof actual.recordUnionVisibilitySql>[0]) => {
      unionSqlCalls.push(input)
      lastUnionSql.value = actual.recordUnionVisibilitySql(input)
      return lastUnionSql.value as never
    },
  }
})

import { RecordPickerService } from './record-picker-service'

/** Every EntityInstance row the org holds, as the fake DB would return them. */
const ROWS = [
  { defId: VIEWABLE_DEF, id: 'inst_viewable' },
  { defId: GRANTED_DEF, id: GRANTED_ROW_ID },
  { defId: GRANTED_DEF, id: 'inst_sibling' }, // same def, NOT shared
  { defId: INVISIBLE_DEF, id: 'inst_invisible' },
  { defId: CONTACT_DEF, id: 'inst_contact' },
].map((row) => ({
  id: row.id,
  entityDefinitionId: row.defId,
  displayName: `Acme ${row.id}`,
  secondaryDisplayValue: null,
  avatarUrl: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}))

const RESOURCES = [
  { id: VIEWABLE_DEF, entityDefinitionId: VIEWABLE_DEF, entityType: null },
  { id: GRANTED_DEF, entityDefinitionId: GRANTED_DEF, entityType: null },
  { id: INVISIBLE_DEF, entityDefinitionId: INVISIBLE_DEF, entityType: null },
  { id: CONTACT_DEF, entityDefinitionId: CONTACT_DEF, entityType: 'contact' },
]

/** Does `outer` embed `needle` anywhere in its chunk tree? (object identity). */
function embeds(outer: unknown, needle: unknown): boolean {
  if (needle === undefined) return false
  if (outer === needle) return true
  const chunks = (outer as { queryChunks?: unknown[] } | null)?.queryChunks
  if (!Array.isArray(chunks)) return false
  return chunks.some((chunk) => embeds(chunk, needle))
}

/** A `CapabilityView` stub with only the two members the union arm reads. */
function view(viewable: string[], granted: string[]) {
  return {
    canViewEntity: (def: string) => viewable.includes(def),
    hasRecordGrantsOn: (def: string) => granted.includes(def),
  } as never
}

/**
 * Run the unscoped union search.
 *
 * The `db` answers the EntityInstance leg only: when the visibility predicate is
 * embedded in the query it behaves like Postgres would, and rows of a grant-only
 * def survive only if they carry a grant. The system-table legs have no `query`
 * API here, so they throw and are swallowed by the union's per-kind catch — they
 * are not the subject of these tests.
 */
async function searchUnscoped(capabilities: unknown) {
  const db = {
    execute: async (query: unknown) => {
      const narrowed = embeds(query, lastUnionSql.value)
      const rows = narrowed
        ? ROWS.filter((row) => row.entityDefinitionId !== GRANTED_DEF || row.id === GRANTED_ROW_ID)
        : ROWS
      return { rows }
    },
  } as never

  const service = new RecordPickerService('org_1', 'user_1', db, capabilities as never)
  const result = await service.search({ query: 'Acme', limit: 20 })
  return { result, recordIds: result.items.map((item) => item.recordId), calls: unionSqlCalls }
}

describe('§5.1 UNSCOPED arm — grant-only defs reach the global search', () => {
  beforeEach(() => {
    unionSqlCalls.length = 0
    lastUnionSql.value = undefined
    getCachedResources.mockReset()
    getCachedResources.mockResolvedValue(RESOURCES)
  })

  it('a def-viewable member sees every matching row of that def', async () => {
    const { recordIds } = await searchUnscoped(view([VIEWABLE_DEF], []))
    expect(recordIds).toContain(`${VIEWABLE_DEF}:inst_viewable`)
  })

  it('a grant-only member sees the SHARED row and NOT its siblings', async () => {
    const { recordIds, calls } = await searchUnscoped(view([], [GRANTED_DEF]))

    // The narrowing is a SQL predicate naming exactly the grant-only defs…
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ grantOnlyDefIds: [GRANTED_DEF], organizationId: 'org_1' })

    // …so the shared row surfaces and the sibling on the same def does not.
    expect(recordIds).toContain(`${GRANTED_DEF}:${GRANTED_ROW_ID}`)
    expect(recordIds).not.toContain(`${GRANTED_DEF}:inst_sibling`)
  })

  it('a member with neither the def nor a grant on it sees nothing of it', async () => {
    const { recordIds } = await searchUnscoped(view([VIEWABLE_DEF], [GRANTED_DEF]))
    expect(recordIds).not.toContain(`${INVISIBLE_DEF}:inst_invisible`)
    // …while the two doors they DO hold both open.
    expect(recordIds).toContain(`${VIEWABLE_DEF}:inst_viewable`)
    expect(recordIds).toContain(`${GRANTED_DEF}:${GRANTED_ROW_ID}`)
  })

  it('a member with NOTHING sees nothing at all', async () => {
    const { recordIds, calls } = await searchUnscoped(view([], []))
    expect(calls).toHaveLength(0)
    expect(recordIds).toEqual([])
  })

  it('contacts stay OUT of the record lane even when a grant names one', async () => {
    // A `contact` grant canonicalizes into the MAIL keyspace and would fan a full
    // lens across that contact's whole conversation history (§10.1).
    const { recordIds, calls } = await searchUnscoped(view([], [CONTACT_DEF, GRANTED_DEF]))
    expect(calls[0]).toMatchObject({ grantOnlyDefIds: [GRANTED_DEF] })
    expect(recordIds).not.toContain(`${CONTACT_DEF}:inst_contact`)
  })

  it('a member holding no per-record grant pays for NO predicate at all', async () => {
    const { calls, recordIds } = await searchUnscoped(view([VIEWABLE_DEF], []))
    expect(calls).toHaveLength(0)
    expect(recordIds).toEqual([`${VIEWABLE_DEF}:inst_viewable`])
  })

  it('an internal caller (no capabilities) stays unfiltered, as before', async () => {
    const { recordIds, calls } = await searchUnscoped(undefined)
    expect(calls).toHaveLength(0)
    expect(recordIds).toContain(`${INVISIBLE_DEF}:inst_invisible`)
    expect(recordIds).toContain(`${CONTACT_DEF}:inst_contact`)
  })
})
