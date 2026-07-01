// packages/lib/src/identity/__tests__/find.test.ts

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

const eq = vi.fn((col: any, val: any) => ({ type: 'eq', col, val }))
const isNull = vi.fn((col: any) => ({ type: 'isNull', col }))
const and = vi.fn((...conds: any[]) => ({ type: 'and', conds }))
vi.mock('drizzle-orm', () => ({ eq, isNull, and }))

vi.mock('@auxx/types/resource', () => ({
  toRecordId: (defId: string, instId: string) => `${defId}:${instId}`,
}))

function buildDb(rows: any[]) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ limit })
  const innerJoin = vi.fn().mockReturnValue({ where })
  const from = vi.fn().mockReturnValue({ innerJoin })
  const select = vi.fn().mockReturnValue({ from })
  return { select, from, innerJoin, where, limit }
}

describe('findRecordByIdentity', () => {
  let findRecordByIdentity: typeof import('../find')['findRecordByIdentity']

  beforeAll(async () => {
    ;({ findRecordByIdentity } = await import('../find'))
  })

  beforeEach(() => {
    eq.mockClear()
    isNull.mockClear()
    and.mockClear()
  })

  it('omits the connectionId/appFieldKey filters when not provided (cross-store, "any app/store" match)', async () => {
    const db = buildDb([
      { entityInstanceId: 'inst_1', entityDefinitionId: 'def_contact', displayName: 'Jane' },
    ])

    const result = await findRecordByIdentity(
      {
        organizationId: 'org_1',
        entityDefinitionId: 'def_contact',
        source: 'shopify',
        externalId: '207119551',
      },
      db as any
    )

    expect(isNull).not.toHaveBeenCalled()
    expect(result).toEqual({ recordId: 'def_contact:inst_1', displayName: 'Jane' })
  })

  it('requires connectionId IS NULL when connectionId is explicitly null (app-less chat link)', async () => {
    const db = buildDb([])

    await findRecordByIdentity(
      {
        organizationId: 'org_1',
        entityDefinitionId: 'def_contact',
        source: 'chat',
        externalId: 'visitor_1',
        connectionId: null,
      },
      db as any
    )

    expect(isNull).toHaveBeenCalledTimes(1)
  })

  it('scopes to one connection + kind when both are provided (mandatory for id-based chat resolution)', async () => {
    const db = buildDb([])

    await findRecordByIdentity(
      {
        organizationId: 'org_1',
        entityDefinitionId: 'def_contact',
        source: 'shopify',
        externalId: '207119551',
        connectionId: 'conn_us',
        appFieldKey: 'customerId',
      },
      db as any
    )

    expect(isNull).not.toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('RecordIdentity.connectionId', 'conn_us')
    expect(eq).toHaveBeenCalledWith('RecordIdentity.appFieldKey', 'customerId')
  })

  it('returns null when no row matches', async () => {
    const db = buildDb([])

    const result = await findRecordByIdentity(
      {
        organizationId: 'org_1',
        entityDefinitionId: 'def_contact',
        source: 'shopify',
        externalId: 'missing',
      },
      db as any
    )

    expect(result).toBeNull()
  })
})
