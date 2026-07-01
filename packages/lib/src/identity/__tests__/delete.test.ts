// packages/lib/src/identity/__tests__/delete.test.ts

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

describe('deleteRecordIdentity', () => {
  let deleteRecordIdentity: typeof import('../delete')['deleteRecordIdentity']

  beforeAll(async () => {
    ;({ deleteRecordIdentity } = await import('../delete'))
  })

  beforeEach(() => {
    eq.mockClear()
    isNull.mockClear()
    and.mockClear()
  })

  it('filters connectionId/appFieldKey IS NULL when omitted', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const db = { delete: vi.fn().mockReturnValue({ where }) }

    const result = await deleteRecordIdentity(
      { organizationId: 'org_1', entityInstanceId: 'inst_1', source: 'chat' },
      db as any
    )

    expect(db.delete).toHaveBeenCalled()
    expect(isNull).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
  })

  it('filters by exact connectionId/appFieldKey when provided', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const db = { delete: vi.fn().mockReturnValue({ where }) }

    await deleteRecordIdentity(
      {
        organizationId: 'org_1',
        entityInstanceId: 'inst_1',
        source: 'shopify',
        connectionId: 'conn_us',
        appFieldKey: 'customerId',
      },
      db as any
    )

    expect(isNull).not.toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('RecordIdentity.connectionId', 'conn_us')
    expect(eq).toHaveBeenCalledWith('RecordIdentity.appFieldKey', 'customerId')
  })

  it('returns Result.error (not a throw) when the delete fails', async () => {
    const db = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('boom')),
      }),
    }

    const result = await deleteRecordIdentity(
      { organizationId: 'org_1', entityInstanceId: 'inst_1', source: 'chat' },
      db as any
    )

    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('boom')
  })
})
