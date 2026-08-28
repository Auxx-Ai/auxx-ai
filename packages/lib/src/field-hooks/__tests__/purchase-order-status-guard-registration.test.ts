// packages/lib/src/field-hooks/__tests__/purchase-order-status-guard-registration.test.ts
//
// 🛑 `purchase_order_status` is guarded on BOTH hook chains and they cover different doors.
// The system hook (`resources/hooks/purchasing-hooks.ts`) runs for `record.create` /
// `record.update`, the CSV importer and the SDK. The field pre-hook runs for
// `fieldValue.set` / `setBulk` — the drawer, the grid's inline edit and a kanban drag, which
// is how a human would actually try to type `issued`. Losing either registration narrows
// coverage silently: nothing throws, the guard simply stops seeing that door.
//
// Separate from `pre/purchase-order-status-guard.test.ts` because `getFieldPreHooks`
// self-inits the whole hook bootstrap, which needs the real `@auxx/database` module graph.

import { describe, expect, it } from 'vitest'
import { guardManualPurchaseOrderIssued } from '../pre/purchase-order-status-guard'
import { getFieldPreHooks, hasFieldPreHooks } from '../registry'

describe('purchase_order_status guard registration', () => {
  // The client path. This is the registration the plan's "issued is action-set" claim
  // actually depends on.
  it('is on the field pre-hook chain for purchase-orders', () => {
    expect(hasFieldPreHooks('purchase-orders', 'purchase_order_status')).toBe(true)
    expect(getFieldPreHooks('purchase-orders', 'purchase_order_status')).toContain(
      guardManualPurchaseOrderIssued
    )
  })

  // The CRUD path. Kept deliberately — it is the only chain the importer and the SDK take.
  it('is also on the system-hook chain, reachable by entityType', async () => {
    const { getHooksForAttribute } = await import('../../resources/hooks/system-hooks')
    expect(getHooksForAttribute('purchase_order', 'purchase_order_status')).toHaveLength(1)
  })

  // One source for what is guarded, so the two chains cannot drift into disagreeing.
  it('guards the same value set and message on both chains', async () => {
    const { PURCHASE_ORDER_ACTION_STATUSES, PURCHASE_ORDER_ACTION_STATUS_MESSAGE } = await import(
      '../../resources/hooks/lifecycle-status-guard'
    )
    expect([...PURCHASE_ORDER_ACTION_STATUSES]).toEqual(['issued'])

    const { PURCHASE_ORDER_HOOKS } = await import('../../resources/hooks/purchasing-hooks')
    const systemHook = PURCHASE_ORDER_HOOKS.purchase_order_status![0]!
    const systemRejection = systemHook({
      operation: 'update',
      field: { id: 'f-status', systemAttribute: 'purchase_order_status' },
      values: { 'f-status': 'issued' },
    } as any)
    await expect(systemRejection).rejects.toThrow(PURCHASE_ORDER_ACTION_STATUS_MESSAGE)

    await expect(
      guardManualPurchaseOrderIssued({
        newValue: { type: 'option', optionId: 'issued' },
      } as any)
    ).rejects.toThrow(PURCHASE_ORDER_ACTION_STATUS_MESSAGE)
  })

  // The `purchase_order_line` evidence lock is a different guard on a different slug; a
  // registration mix-up between the two would be invisible.
  it('does not leak onto the line def', () => {
    expect(hasFieldPreHooks('purchase-order-lines', 'purchase_order_status')).toBe(false)
  })
})
