// packages/lib/src/identity/__tests__/upsert.test.ts

import { beforeAll, describe, expect, it, vi } from 'vitest'

const schemaHandler: ProxyHandler<any> = {
  get(_target, tableProp) {
    return new Proxy(
      {},
      {
        get(_t, colProp) {
          return `${String(tableProp)}.${String(colProp)}`
        },
      }
    )
  },
}
const mockSchema = new Proxy({}, schemaHandler)

vi.mock('@auxx/database', () => ({
  database: {},
  schema: mockSchema,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((col: any, val: any) => ({ type: 'eq', col, val })),
  isNull: vi.fn((col: any) => ({ type: 'isNull', col })),
}))

import type { UpsertRecordIdentityInput } from '../types'

function buildInput(overrides: Partial<UpsertRecordIdentityInput> = {}): UpsertRecordIdentityInput {
  return {
    organizationId: 'org_1',
    entityInstanceId: 'inst_1',
    entityDefinitionId: 'def_contact',
    source: 'shopify',
    connectionId: 'conn_us',
    appFieldKey: 'customerId',
    fieldId: 'field_1',
    externalId: '207119551',
    ...overrides,
  }
}

describe('upsertRecordIdentity', () => {
  let upsertRecordIdentity: typeof import('../upsert')['upsertRecordIdentity']

  beforeAll(async () => {
    ;({ upsertRecordIdentity } = await import('../upsert'))
  })

  it('updates the existing row when one matches the record+kind key (idempotent — no duplicate insert)', async () => {
    const existing = { id: 'ri_1', externalId: '207119551' }
    const updated = { id: 'ri_1', externalId: '207119551', updatedAt: new Date() }
    const returning = vi.fn().mockResolvedValue([updated])
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    const db = {
      query: { RecordIdentity: { findFirst: vi.fn().mockResolvedValue(existing) } },
      update: vi.fn().mockReturnValue({ set }),
      insert: vi.fn(),
    }

    const result = await upsertRecordIdentity(buildInput(), db as any)

    expect(db.update).toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ externalId: '207119551' }))
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(updated)
  })

  it('inserts a new row when no existing row matches the record+kind key', async () => {
    const created = { id: 'ri_2', externalId: '207119551' }
    const returning = vi.fn().mockResolvedValue([created])
    const values = vi.fn().mockReturnValue({ returning })
    const db = {
      query: { RecordIdentity: { findFirst: vi.fn().mockResolvedValue(undefined) } },
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn(),
    }

    const result = await upsertRecordIdentity(buildInput(), db as any)

    expect(db.insert).toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        entityInstanceId: 'inst_1',
        source: 'shopify',
        connectionId: 'conn_us',
        appFieldKey: 'customerId',
        externalId: '207119551',
      })
    )
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(created)
  })

  it('defaults appInstallationId/connectionId/appFieldKey/fieldId to null when omitted (app-less chat link)', async () => {
    const created = { id: 'ri_3' }
    const returning = vi.fn().mockResolvedValue([created])
    const values = vi.fn().mockReturnValue({ returning })
    const db = {
      query: { RecordIdentity: { findFirst: vi.fn().mockResolvedValue(undefined) } },
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn(),
    }

    await upsertRecordIdentity(
      buildInput({
        connectionId: undefined,
        appFieldKey: undefined,
        fieldId: undefined,
        appInstallationId: undefined,
        source: 'chat',
        externalId: 'visitor_1',
      }),
      db as any
    )

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        appInstallationId: null,
        connectionId: null,
        appFieldKey: null,
        fieldId: null,
      })
    )
  })

  it('surfaces a unique-key violation (a different record already owns this identity) as Result.error, not a throw', async () => {
    const db = {
      query: { RecordIdentity: { findFirst: vi.fn().mockResolvedValue(undefined) } },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockRejectedValue(
              new Error(
                'duplicate key value violates unique constraint "RecordIdentity_identity_key"'
              )
            ),
        }),
      }),
      update: vi.fn(),
    }

    const result = await upsertRecordIdentity(buildInput(), db as any)

    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('RecordIdentity_identity_key')
  })
})
