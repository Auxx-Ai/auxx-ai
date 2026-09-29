// packages/lib/src/usage/__tests__/records-limit.test.ts

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageLimitError } from '../../errors'
import { resolveSystemEntityBehavior } from '../../resources/registry/system-entity-behavior'
import type { Resource } from '../../resources/registry/types'

const h = vi.hoisted(() => ({
  limits: {} as Record<string, unknown>,
  resources: [] as unknown[],
  /** `[cached, fresh]` counts served by the mocked `readMeteredRecordCount`. */
  counts: { cached: 0, fresh: 0 },
  childMappingDefIds: [] as string[],
  childMappingWhere: [] as SQL[],
}))

// The real schema, so the child-mapping filter's columns can be rendered and asserted.
vi.mock('@auxx/database', async (importOriginal) => importOriginal())

vi.mock('../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    getLimit = vi.fn(async (_orgId: string, key: string) => h.limits[key] ?? null)
  },
}))

vi.mock('../../cache', () => ({
  getCachedResources: vi.fn(async () => h.resources),
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      (h.resources as Resource[]).find(
        (r) => r.id === key || r.entityType === key || r.apiSlug === key
      ) ?? null
  ),
}))

const readMeteredRecordCount = vi.fn(
  async (_db: unknown, _org: string, opts?: { fresh?: boolean }) =>
    opts?.fresh ? h.counts.fresh : h.counts.cached
)
vi.mock('../records-count', () => ({
  readMeteredRecordCount: (...args: [unknown, string, { fresh?: boolean }?]) =>
    readMeteredRecordCount(...args),
}))

import { assertRecordRoom, readRecordsHeadroom, readRecordsUsage } from '../records-limit'
import { isMeteredResource, readMeteredDefIds } from '../records-metered'

/** A db stub whose child-mapping query answers from `h.childMappingDefIds` and records its filter. */
const db = {
  selectDistinct: () => ({
    from: () => ({
      where: async (where: SQL) => {
        h.childMappingWhere.push(where)
        return h.childMappingDefIds.map((entityDefinitionId) => ({ entityDefinitionId }))
      },
    }),
  }),
} as never

const renderWhere = (where: SQL) => new PgDialect().sqlToQuery(where)

function def(id: string, entityType?: string, dataConnectorId?: string): Resource {
  return {
    id,
    entityDefinitionId: id,
    entityType,
    apiSlug: entityType ?? id,
    type: 'custom',
    fields: [],
    dataConnectorId,
    ...resolveSystemEntityBehavior(entityType),
  } as unknown as Resource
}

function tableBacked(id: string): Resource {
  return {
    id,
    entityDefinitionId: id,
    entityType: id,
    apiSlug: id,
    type: 'system',
    fields: [],
    metered: false,
  } as unknown as Resource
}

beforeEach(() => {
  h.limits = { recordsHard: 1000, recordsSoft: 800 }
  h.counts = { cached: 0, fresh: 0 }
  h.childMappingDefIds = []
  h.childMappingWhere = []
  h.resources = [
    def('def_contact', 'contact'),
    def('def_line', 'line_item'),
    def('def_custom'),
    def('def_conn_order', undefined, 'conn_1'),
    def('def_conn_line', undefined, 'conn_1'),
    tableBacked('thread'),
  ]
  readMeteredRecordCount.mockClear()
})

describe('metered classification', () => {
  it('counts main system records and custom defs, not lines or table-backed rows', async () => {
    const ids = await readMeteredDefIds(db, 'org_1')
    expect(ids.sort()).toEqual(['def_conn_line', 'def_conn_order', 'def_contact', 'def_custom'])
  })

  it('excludes a connector-owned def that is the target of a child mapping', async () => {
    h.childMappingDefIds = ['def_conn_line']
    const ids = await readMeteredDefIds(db, 'org_1')
    expect(ids).toContain('def_conn_order')
    expect(ids).not.toContain('def_conn_line')
  })

  it('asks only for org-scoped child mappings over the connector-owned defs', async () => {
    await readMeteredDefIds(db, 'org_1')
    expect(h.childMappingWhere).toHaveLength(1)
    const { sql, params } = renderWhere(h.childMappingWhere[0]!)
    expect(sql).toMatch(/"organizationId" = \$1/)
    expect(sql).toMatch(/"parentMappingId" is not null/)
    expect(sql).toMatch(/"entityDefinitionId" in \(\$2, \$3\)/)
    expect(params).toEqual(['org_1', 'def_conn_order', 'def_conn_line'])
  })

  it('skips the child-mapping query when no metered def is connector-owned', async () => {
    h.resources = [def('def_contact', 'contact'), def('def_custom')]
    expect(await readMeteredDefIds(db, 'org_1')).toEqual(['def_contact', 'def_custom'])
    expect(h.childMappingWhere).toHaveLength(0)
  })

  it('keeps an ownerless def counted even when a child mapping writes into it', () => {
    const contributing = def('def_custom')
    expect(isMeteredResource(contributing, new Set(['def_custom']))).toBe(true)
  })
})

describe('readRecordsUsage / readRecordsHeadroom', () => {
  it('reports soft and hard flags against the plan limits', async () => {
    h.counts.cached = 850
    const usage = await readRecordsUsage(db, 'org_1')
    expect(usage._unsafeUnwrap()).toEqual({
      count: 850,
      soft: 800,
      hard: 1000,
      softReached: true,
      hardReached: false,
    })
    expect((await readRecordsHeadroom(db, 'org_1'))._unsafeUnwrap()).toBe(150)
  })

  it('floors headroom at 0 when an org is over hard (syncs keep writing)', async () => {
    h.counts.cached = 1200
    expect((await readRecordsHeadroom(db, 'org_1'))._unsafeUnwrap()).toBe(0)
    expect((await readRecordsUsage(db, 'org_1'))._unsafeUnwrap().hardReached).toBe(true)
  })

  it('is unlimited for enterprise (-1 folded to +) and for a plan without the key', async () => {
    h.limits = { recordsHard: '+', recordsSoft: '+' }
    expect((await readRecordsHeadroom(db, 'org_1'))._unsafeUnwrap()).toBeNull()
    h.limits = {}
    const usage = (await readRecordsUsage(db, 'org_1'))._unsafeUnwrap()
    expect(usage.hard).toBeNull()
    expect(usage.softReached).toBe(false)
  })
})

describe('assertRecordRoom', () => {
  it('allows a create under hard', async () => {
    h.counts.cached = 999
    await expect(assertRecordRoom(db, 'org_1', { entityDefinitionId: 'contact' })).resolves.toEqual(
      { metered: true }
    )
    expect(readMeteredRecordCount).toHaveBeenCalledTimes(1)
  })

  it('blocks at hard with an upgrade-required UsageLimitError after a fresh recount', async () => {
    h.counts = { cached: 1000, fresh: 1000 }
    const error = await assertRecordRoom(db, 'org_1', { entityDefinitionId: 'contact' }).catch(
      (e) => e
    )
    expect(error).toBeInstanceOf(UsageLimitError)
    expect(error.details).toMatchObject({ metric: 'records', upgradeRequired: 'true' })
    expect(readMeteredRecordCount).toHaveBeenLastCalledWith(db, 'org_1', { fresh: true })
  })

  it('lets a stale cache pass when deletes freed room', async () => {
    h.counts = { cached: 1000, fresh: 990 }
    await expect(assertRecordRoom(db, 'org_1', { entityDefinitionId: 'contact' })).resolves.toEqual(
      { metered: true }
    )
  })

  it('refuses a batch that would pass hard, even from under it', async () => {
    h.counts = { cached: 900, fresh: 900 }
    await expect(
      assertRecordRoom(db, 'org_1', { entityDefinitionId: 'def_custom', quantity: 101 })
    ).rejects.toThrow(/room for 100 more/)
    await expect(
      assertRecordRoom(db, 'org_1', { entityDefinitionId: 'def_custom', quantity: 100 })
    ).resolves.toEqual({ metered: true })
  })

  it('never blocks an unmetered def, and never counts for it', async () => {
    h.counts = { cached: 5000, fresh: 5000 }
    await expect(
      assertRecordRoom(db, 'org_1', { entityDefinitionId: 'line_item' })
    ).resolves.toEqual({ metered: false })
    expect(readMeteredRecordCount).not.toHaveBeenCalled()
  })

  it('checks org-level room when no def is named (connector sync starts)', async () => {
    h.counts = { cached: 1000, fresh: 1000 }
    await expect(assertRecordRoom(db, 'org_1', {})).rejects.toBeInstanceOf(UsageLimitError)
  })
})
