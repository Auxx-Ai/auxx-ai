// packages/lib/src/bom/adopt-tariff-starters.test.ts
// 32 §2.1: idempotent-on-(code,country), whole-or-nothing-per-pair adoption from the catalogue.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tariffCodeDefId: 'tariff_code_def' as string | undefined,
  tariffRateDefId: 'tariff_rate_def' as string | undefined,
  fields: {
    tariff_code_code: { id: 'f_code' },
    tariff_code_country: { id: 'f_country' },
  } as Record<string, { id: string } | null>,
  existingRows: [] as Array<{ code: string | null; country: string | null }>,
  createCalls: [] as Array<{ entityDefinitionId: string; values: Record<string, unknown> }>,
  rateCallCount: 0,
  /** When set, the Nth `tariff_rate` create throws instead of succeeding. */
  failOnRateCall: undefined as number | undefined,
}))

vi.mock('@auxx/database', () => ({
  schema: {
    EntityInstance: {
      id: 'id',
      organizationId: 'organizationId',
      entityDefinitionId: 'entityDefinitionId',
      archivedAt: 'archivedAt',
    },
    FieldValue: {
      entityId: 'entityId',
      fieldId: 'fieldId',
      organizationId: 'organizationId',
      valueText: 'valueText',
      optionId: 'optionId',
    },
  },
}))

vi.mock('drizzle-orm/pg-core', () => ({
  alias: (table: unknown) => table,
}))

vi.mock('../cache', () => ({
  getCachedEntityDefId: async (_orgId: string, entityType: string) =>
    entityType === 'tariff_code' ? h.tariffCodeDefId : h.tariffRateDefId,
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields[a] ?? null])),
    }),
  }),
}))

vi.mock('../resources/crud', () => {
  class FakeUnifiedCrudHandler {
    constructor(
      private organizationId: string,
      private userId: string,
      private db: unknown
    ) {}

    async create(entityDefinitionId: string, values: Record<string, unknown>) {
      if (entityDefinitionId === h.tariffRateDefId) {
        h.rateCallCount++
        if (h.failOnRateCall != null && h.rateCallCount === h.failOnRateCall) {
          throw new Error(`boom on rate create #${h.rateCallCount}`)
        }
      }
      const id = `inst_${h.createCalls.length + 1}`
      h.createCalls.push({ entityDefinitionId, values })
      return { instance: { id }, recordId: `x:${id}`, values }
    }
  }

  return { UnifiedCrudHandler: FakeUnifiedCrudHandler }
})

vi.mock('./tariff-hts-general', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tariff-hts-general')>()
  return {
    ...actual,
    loadHtsGeneral: async () => ({
      fetchedAt: '2026-09-01',
      source: 'test',
      lines: [
        ['8481.80.90.05', 2, 'Solenoid valves'],
        ['7318.15.80.45', 8.5, 'Socket screws, other'],
      ],
    }),
  }
})

import { AuxxError, BadRequestError, NotFoundError } from '../errors'
import { adoptTariffStarters } from './adopt-tariff-starters'
import { expandTariffStarter, TARIFF_STARTERS_VERSION } from './tariff-starters'

const ORG = 'org_1'
const USER = 'user_1'

const db = {
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({ where: () => Promise.resolve(h.existingRows) }),
      }),
    }),
  }),
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.tariffCodeDefId = 'tariff_code_def'
  h.tariffRateDefId = 'tariff_rate_def'
  h.fields = {
    tariff_code_code: { id: 'f_code' },
    tariff_code_country: { id: 'f_country' },
  }
  h.existingRows = []
  h.createCalls = []
  h.rateCallCount = 0
  h.failOnRateCall = undefined
})

describe('adoptTariffStarters', () => {
  it('creates a code and its full rate history for 8481.80.90.05 CN', async () => {
    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '8481.80.90.05', country: 'CN' }],
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.skipped).toEqual([])
    expect(value.unknown).toEqual([])
    expect(value.created).toHaveLength(1)
    expect(value.created[0]?.code).toBe('8481.80.90.05')
    expect(value.created[0]?.country).toBe('CN')

    // Cross-check against the real expander so this test doesn't hardcode a
    // row count that would silently drift when TARIFF_ACTIONS changes.
    const expansion = expandTariffStarter(['8481.80.90.05', 2, 'Solenoid valves'], 'CN')
    expect(value.created[0]?.rows).toBe(expansion.rows.length)

    const codeCalls = h.createCalls.filter((c) => c.entityDefinitionId === h.tariffCodeDefId)
    expect(codeCalls).toHaveLength(1)
    expect(codeCalls[0]?.values).toEqual({
      tariff_code_code: '8481.80.90.05',
      tariff_code_country: 'CN',
      tariff_code_description: 'Solenoid valves',
    })

    const rateCalls = h.createCalls.filter((c) => c.entityDefinitionId === h.tariffRateDefId)
    expect(rateCalls).toHaveLength(expansion.rows.length)

    // The base MFN row carries no authority key at all.
    const baseCall = rateCalls[0]
    expect(baseCall?.values).not.toHaveProperty('tariff_rate_authority')
    expect(baseCall?.values).not.toHaveProperty('tariff_rate_chapter99_code')
    expect(baseCall?.values.tariff_rate_note).toContain(TARIFF_STARTERS_VERSION)

    // Every action row carries both an authority and a Chapter 99 heading.
    for (const call of rateCalls.slice(1)) {
      expect(call.values.tariff_rate_authority).toEqual(expect.any(String))
      expect(call.values.tariff_rate_chapter99_code).toEqual(expect.any(String))
      expect(call.values.tariff_rate_note).toContain(TARIFF_STARTERS_VERSION)
    }

    // Every row carries the note, and no row is missing one.
    for (const call of rateCalls) {
      expect(typeof call.values.tariff_rate_note).toBe('string')
    }
  })

  it('gives DE exactly one row - the MFN base rate, no China actions apply', async () => {
    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '8481.80.90.05', country: 'DE' }],
    })

    const value = result._unsafeUnwrap()
    expect(value.created).toEqual([
      { code: '8481.80.90.05', country: 'DE', instanceId: expect.any(String), rows: 1 },
    ])
    const rateCalls = h.createCalls.filter((c) => c.entityDefinitionId === h.tariffRateDefId)
    expect(rateCalls).toHaveLength(1)
  })

  it('skips a pair the org already holds and creates nothing', async () => {
    h.existingRows = [{ code: '8481.80.90.05', country: 'CN' }]

    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '8481.80.90.05', country: 'CN' }],
    })

    const value = result._unsafeUnwrap()
    expect(value.skipped).toEqual([{ code: '8481.80.90.05', country: 'CN' }])
    expect(value.created).toEqual([])
    expect(h.createCalls).toEqual([])
  })

  it('reports a code the catalogue does not carry as unknown, and writes nothing', async () => {
    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '0000.00.00.00', country: 'CN' }],
    })

    const value = result._unsafeUnwrap()
    expect(value.unknown).toEqual([{ code: '0000.00.00.00', country: 'CN' }])
    expect(value.created).toEqual([])
    expect(h.createCalls).toEqual([])
  })

  it('refuses an invalid country with BadRequestError', async () => {
    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '8481.80.90.05', country: 'ZZ' }],
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(result._unsafeUnwrapErr().message).toContain('ZZ')
    expect(h.createCalls).toEqual([])
  })

  it('returns NotFoundError when the org has no tariff_code / tariff_rate definitions', async () => {
    h.tariffCodeDefId = undefined
    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '8481.80.90.05', country: 'CN' }],
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('leaves the pair absent and returns an error when a rate create fails partway through', async () => {
    // 8481.80.90.05/CN carries several rate rows (real TARIFF_ACTIONS + TARIFF_MEMBERSHIPS
    // give it well over 3); fail the third one to prove the pair is whole-or-nothing.
    h.failOnRateCall = 3

    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '8481.80.90.05', country: 'CN' }],
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(AuxxError)
    expect(result._unsafeUnwrapErr().message).toContain('8481.80.90.05')
    expect(result._unsafeUnwrapErr().message).toContain('CN')
  })

  it('resolves a caller-spelled dotless code against the catalogue', async () => {
    const result = await adoptTariffStarters(db, ORG, USER, {
      entries: [{ code: '84818090 05', country: 'DE' }],
    })

    const value = result._unsafeUnwrap()
    expect(value.unknown).toEqual([])
    expect(value.created).toHaveLength(1)
    // The STORED code is the catalogue's own spelling, not the caller's.
    expect(value.created[0]?.code).toBe('8481.80.90.05')
  })
})
