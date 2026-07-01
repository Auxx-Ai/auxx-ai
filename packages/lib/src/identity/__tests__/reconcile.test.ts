// packages/lib/src/identity/__tests__/reconcile.test.ts

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
  inArray: vi.fn((col: any, vals: any[]) => ({ type: 'inArray', col, vals })),
  isNotNull: vi.fn((col: any) => ({ type: 'isNotNull', col })),
  isNull: vi.fn((col: any) => ({ type: 'isNull', col })),
}))

describe('reconcileRecordIdentities', () => {
  let reconcileRecordIdentities: typeof import('../reconcile')['reconcileRecordIdentities']

  beforeAll(async () => {
    ;({ reconcileRecordIdentities } = await import('../reconcile'))
  })

  function buildDb({
    identityCells,
    orphaned,
    findFirstResult,
  }: {
    identityCells: any[]
    orphaned: any[]
    findFirstResult?: any
  }) {
    const select = vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(identityCells),
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(orphaned),
        }),
      }),
    }))
    const del = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    const db = {
      select,
      delete: del,
      query: { RecordIdentity: { findFirst: vi.fn().mockResolvedValue(findFirstResult) } },
      insert: vi.fn().mockReturnValue({
        values: vi
          .fn()
          .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'ri_new' }]) }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi
            .fn()
            .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'ri_1' }]) }),
        }),
      }),
    }
    return { db, del }
  }

  it('upserts a mirror row for each identity FieldValue cell found via the join', async () => {
    const { db } = buildDb({
      identityCells: [
        {
          entityId: 'inst_1',
          entityDefinitionId: 'def_contact',
          valueText: '207119551',
          fieldId: 'field_1',
          appSlug: 'shopify',
          appInstallationId: 'install_1',
          connectionId: 'conn_us',
          appFieldKey: 'customerId',
        },
      ],
      orphaned: [],
    })

    const result = await reconcileRecordIdentities('org_1', db as any)

    expect(db.insert).toHaveBeenCalled()
    expect(result.upserted).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('skips a cell with no appSlug (source cannot be determined)', async () => {
    const { db } = buildDb({
      identityCells: [
        {
          entityId: 'inst_1',
          entityDefinitionId: 'def_contact',
          valueText: '207119551',
          fieldId: 'field_1',
          appSlug: null,
          appInstallationId: 'install_1',
          connectionId: 'conn_us',
          appFieldKey: 'customerId',
        },
      ],
      orphaned: [],
    })

    const result = await reconcileRecordIdentities('org_1', db as any)

    expect(db.insert).not.toHaveBeenCalled()
    expect(result.upserted).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('deletes mirror rows whose backing FieldValue cell is gone', async () => {
    const { db, del } = buildDb({
      identityCells: [],
      orphaned: [{ id: 'ri_stale_1' }, { id: 'ri_stale_2' }],
    })

    const result = await reconcileRecordIdentities('org_1', db as any)

    expect(del).toHaveBeenCalled()
    expect(result.orphanedDeleted).toBe(2)
  })

  it('does not issue a delete when nothing is orphaned', async () => {
    const { db, del } = buildDb({ identityCells: [], orphaned: [] })

    const result = await reconcileRecordIdentities('org_1', db as any)

    expect(del).not.toHaveBeenCalled()
    expect(result.orphanedDeleted).toBe(0)
  })
})
