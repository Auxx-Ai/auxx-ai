// packages/lib/src/settings/__tests__/read.test.ts
//
// `readOrganizationSettings` (LIB-LAYOUT.md §3e): one cache read without `db`,
// one `SELECT … WHERE key IN (…)` with it, both merged over catalog defaults —
// plus the per-key typing `SettingValueFor` derives from the catalog default.

import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { SettingValue } from '../types'

const h = vi.hoisted(() => ({
  /** What the org cache hands back for `orgSettings`. */
  cached: {} as Record<string, unknown>,
  getCalls: [] as Array<[string, string]>,
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    get: async (organizationId: string, key: string) => {
      h.getCalls.push([organizationId, key])
      return h.cached
    },
  }),
}))

import { readOrganizationSettings, type SettingValueFor } from '../read'
import { getOrganizationSetting } from '../settings-service'

const ORG = 'org_1'

/** A minimal chainable `db.select().from().where()` resolving to `rows`. */
function fakeDb(rows: Array<{ key: string; value: unknown }>) {
  const promise = Promise.resolve(rows) as Promise<typeof rows> & Record<string, unknown>
  promise.where = () => promise
  return { select: () => ({ from: () => promise }) } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.cached = {}
  h.getCalls = []
})

describe('readOrganizationSettings — typing', () => {
  it('types a boolean-default key as boolean', () => {
    expectTypeOf<SettingValueFor<'accounting.autoPost.fulfillment'>>().toEqualTypeOf<boolean>()
  })

  it('types a number-default key as number', () => {
    expectTypeOf<SettingValueFor<'documents.quote.validDays'>>().toEqualTypeOf<number>()
  })

  it('widens a null-default key to the full SettingValue union rather than lying with null', () => {
    expectTypeOf<SettingValueFor<'accounting.bookTimeZone'>>().toEqualTypeOf<SettingValue>()
  })
})

describe('readOrganizationSettings — without db', () => {
  it('reads the cached orgSettings map once for every requested key', async () => {
    h.cached = { 'accounting.autoPost.fulfillment': true }

    const result = await readOrganizationSettings(ORG, [
      'accounting.autoPost.fulfillment',
      'documents.quote.validDays',
    ] as const)

    expect(result['accounting.autoPost.fulfillment']).toBe(true)
    // Not in the cached map — falls back to the catalog default.
    expect(result['documents.quote.validDays']).toBe(30)
    expect(h.getCalls).toEqual([[ORG, 'orgSettings']])
  })

  it('reads the cache exactly once regardless of how many keys are requested', async () => {
    await readOrganizationSettings(ORG, [
      'accounting.cutoffPeriod',
      'accounting.bookTimeZone',
      'accounting.setupState',
    ] as const)

    expect(h.getCalls).toHaveLength(1)
  })
})

describe('readOrganizationSettings — with db', () => {
  it('selects the rows directly and merges catalog defaults over the gaps, never touching the cache', async () => {
    const db = fakeDb([{ key: 'accounting.autoPost.fulfillment', value: true }])

    const result = await readOrganizationSettings(
      ORG,
      ['accounting.autoPost.fulfillment', 'documents.quote.validDays'] as const,
      db
    )

    expect(result['accounting.autoPost.fulfillment']).toBe(true)
    expect(result['documents.quote.validDays']).toBe(30)
    expect(h.getCalls).toEqual([])
  })
})

describe('getOrganizationSetting — sugar over readOrganizationSettings', () => {
  it('returns the single requested key, cached path by default', async () => {
    h.cached = { 'accounting.autoPost.fulfillment': true }

    const value = await getOrganizationSetting({
      organizationId: ORG,
      key: 'accounting.autoPost.fulfillment',
    })

    expect(value).toBe(true)
    expect(h.getCalls).toEqual([[ORG, 'orgSettings']])
  })

  it('bypasses the cache when a db is supplied', async () => {
    const db = fakeDb([{ key: 'organization.currency', value: 'EUR' }])

    const value = await getOrganizationSetting({
      organizationId: ORG,
      key: 'organization.currency',
      db,
    })

    expect(value).toBe('EUR')
    expect(h.getCalls).toEqual([])
  })
})
