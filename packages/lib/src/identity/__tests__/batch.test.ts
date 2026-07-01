// packages/lib/src/identity/__tests__/batch.test.ts

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
  and: vi.fn((...conds: any[]) => conds),
  eq: vi.fn((col: any, val: any) => ({ col, val })),
  inArray: vi.fn((col: any, vals: any[]) => ({ col, vals })),
}))

vi.mock('@auxx/types/resource', () => ({
  parseRecordId: (recordId: string) => {
    const [entityDefinitionId, entityInstanceId] = recordId.split(':')
    return { entityDefinitionId, entityInstanceId }
  },
}))

describe('getRecordIdentitiesForRecords', () => {
  let getRecordIdentitiesForRecords: typeof import('../batch')['getRecordIdentitiesForRecords']

  beforeAll(async () => {
    ;({ getRecordIdentitiesForRecords } = await import('../batch'))
  })

  it('returns an empty map without querying when recordIds is empty', async () => {
    const select = vi.fn()
    const db = { select }

    const result = await getRecordIdentitiesForRecords('org_1', [], db as any)

    expect(result.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it('batch-loads and groups rows by their originating RecordId (one query for a page of records)', async () => {
    const rows = [
      { id: 'ri_1', entityInstanceId: 'inst_1', source: 'shopify', externalId: '1' },
      { id: 'ri_2', entityInstanceId: 'inst_1', source: 'chat', externalId: 'v1' },
      { id: 'ri_3', entityInstanceId: 'inst_2', source: 'shopify', externalId: '2' },
    ]
    const where = vi.fn().mockResolvedValue(rows)
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const db = { select }

    const result = await getRecordIdentitiesForRecords(
      'org_1',
      ['def_contact:inst_1', 'def_contact:inst_2'],
      db as any
    )

    expect(select).toHaveBeenCalledTimes(1)
    expect(result.get('def_contact:inst_1' as any)).toHaveLength(2)
    expect(result.get('def_contact:inst_2' as any)).toHaveLength(1)
  })

  it('drops rows whose entityInstanceId was not among the requested recordIds', async () => {
    const rows = [
      { id: 'ri_1', entityInstanceId: 'inst_unrequested', source: 'shopify', externalId: '1' },
    ]
    const where = vi.fn().mockResolvedValue(rows)
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const db = { select }

    const result = await getRecordIdentitiesForRecords('org_1', ['def_contact:inst_1'], db as any)

    expect(result.size).toBe(0)
  })
})
