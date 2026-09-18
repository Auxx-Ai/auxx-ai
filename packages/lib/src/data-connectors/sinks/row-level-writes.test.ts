// packages/lib/src/data-connectors/sinks/row-level-writes.test.ts
//
// The write-guard transaction wrapper (`postings/source-write-guard.ts`) is gone
// (accounting migration step 1a/1b) — `executeRowLevelWrites` no longer rebinds
// the handler onto a separate accounting transaction before writing. It just
// runs the append through the handler and stamps ownership through `ctx.db`,
// both against whatever connection the caller already threaded through. This
// pins THAT pipeline: the append happens before the stamp, and the stamp reads
// `ctx.connector.id` and the freshly-appended value/field off `ctx.db` directly.

import { describe, expect, it, vi } from 'vitest'
import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { executeRowLevelWrites } from './row-level-writes'
import type { SyncCtx } from './types'

describe('row-level append', () => {
  it('appends through the handler, then stamps ownership through ctx.db', async () => {
    const events: string[] = []
    const where = vi.fn(async () => {
      events.push('stamp')
    })
    const set = vi.fn(() => ({ where }))
    const db = { update: vi.fn(() => ({ set })) }
    const handler = {
      update: vi.fn(async () => {
        events.push('append')
      }),
    }

    await executeRowLevelWrites(
      { db, orgId: 'org', connector: { id: 'connector' } } as unknown as SyncCtx,
      'def_order',
      handler as unknown as UnifiedCrudHandler,
      'inst_1',
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

    expect(handler.update).toHaveBeenCalledWith(
      'def_order:inst_1',
      { order_payment_gateways: ['shopify_payments'] },
      { order_payment_gateways: 'add' }
    )
    expect(db.update).toHaveBeenCalledOnce()
    expect(set).toHaveBeenCalledWith({ managedByConnectorId: 'connector' })
    // Ordering matters: the stamp targets the row the append just wrote, so it
    // must run after, never before or concurrently with it.
    expect(events).toEqual(['append', 'stamp'])
  })
})
