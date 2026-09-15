// packages/lib/src/data-connectors/sinks/row-level-writes.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { SyncCtx } from './types'

const h = vi.hoisted(() => ({ tx: { update: vi.fn() } }))
vi.mock('../../postings/source-write-guard', () => ({
  withAccountingFieldMutation: async (
    _ctx: unknown,
    _input: unknown,
    fn: (ctx: unknown) => unknown
  ) => fn({ db: h.tx }),
  AcceptedAccountingSourceError: class extends Error {},
  recordRejectedAccountingObservation: vi.fn(),
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: (_org: string, _user: unknown, db: unknown) => ({ db }),
}))

import { executeRowLevelWrites } from './row-level-writes'

describe('transactional connector append', () => {
  it('binds both the append handler and its ownership stamp to the accounting transaction', async () => {
    const events: string[] = []
    const pool = { update: vi.fn() }
    const txHandler = {
      update: vi.fn(async () => {
        events.push('append')
      }),
    }
    const handler = { update: vi.fn(), withDatabase: vi.fn(() => txHandler) }
    h.tx.update.mockReturnValue({
      set: () => ({
        where: async () => {
          events.push('stamp')
        },
      }),
    })
    await executeRowLevelWrites(
      { db: pool, orgId: 'org', connector: { id: 'connector' } } as unknown as SyncCtx,
      'def_order',
      handler as unknown as UnifiedCrudHandler,
      'order',
      [
        {
          kind: 'append',
          column: 'valueText',
          flatValue: 'shopify_payments',
          write: {
            writeKey: 'order_payment_gateways',
            fieldUuid: 'gateway_field',
            value: 'shopify_payments',
            strategy: 'overwrite',
            field: { id: 'gateway_field', type: 'TEXT', modelType: 'order' },
          },
        },
      ]
    )
    expect(handler.withDatabase).toHaveBeenCalledWith(h.tx)
    expect(txHandler.update).toHaveBeenCalledOnce()
    expect(handler.update).not.toHaveBeenCalled()
    expect(pool.update).not.toHaveBeenCalled()
    expect(events).toEqual(['append', 'stamp'])
  })
})
