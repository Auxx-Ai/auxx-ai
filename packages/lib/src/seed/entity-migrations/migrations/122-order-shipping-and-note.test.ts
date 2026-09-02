// packages/lib/src/seed/entity-migrations/migrations/122-order-shipping-and-note.test.ts
//
// Migration 122 is two field inserts on the existing `order` def, so what can silently go
// wrong is never the write itself: it is the registry key list drifting from what actually
// ships, or the fields it adds disagreeing with the shape the Shopify retarget brief needs
// (money plan 37 §6/§8/§10.1) — a CURRENCY shipping total that folds into `order_total`, and
// a human-editable multiline note. These tests pin both, plus the migration's registration
// and its no-op-on-a-fresh-org guard, the way 121's tests do for its own two new fields.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { ORDER_TRIGGER_ATTRS } from '../../../money/totals-hooks'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration122OrderShippingAndNote } from './122-order-shipping-and-note'

/** A `db.select().from().where()` chain resolving to `rows` — enough for `loadExistingState`,
 * which issues exactly this shape twice (EntityDefinition, then CustomField). */
function fakeDb(rows: unknown[]): Database {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
  } as unknown as Database
}

describe('migration 122 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '122-order-shipping-and-note')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration122OrderShippingAndNote.id).toBe('122-order-shipping-and-note')
  })

  it('does not reuse an id already spent in the shared space', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id.startsWith('122-'))).toEqual(['122-order-shipping-and-note'])
  })

  it('sorts after 121 in the ordered registry', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf('122-order-shipping-and-note')).toBeGreaterThan(
      ids.indexOf('121-rate-precision')
    )
  })
})

describe('the registry agrees with the migration: order_shipping_total', () => {
  it('is a CURRENCY field, creatable and updatable — a human/connector INPUT, not derived', () => {
    const field = ORDER_FIELDS.shippingTotal
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('order_shipping_total')
    expect(field?.nullable).toBe(true)
    expect(field?.capabilities?.creatable).toBe(true)
    expect(field?.capabilities?.updatable).toBe(true)
  })

  it('is modelled on purchase_order_shipping_total: same options shape, hidden from the panel', () => {
    const field = ORDER_FIELDS.shippingTotal
    expect(field?.showInPanel).toBe(false)
    expect(field?.options).toEqual({
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    })
  })

  it('is a member of ORDER_TRIGGER_ATTRS — writing it recomputes the order (money plan 37 §6)', () => {
    expect(ORDER_TRIGGER_ATTRS.has('order_shipping_total')).toBe(true)
  })

  it('sorts between taxTotal and total, where the formula folds it in', () => {
    const taxTotal = ORDER_FIELDS.taxTotal?.systemSortOrder ?? ''
    const shippingTotal = ORDER_FIELDS.shippingTotal?.systemSortOrder ?? ''
    const total = ORDER_FIELDS.total?.systemSortOrder ?? ''
    expect(taxTotal < shippingTotal).toBe(true)
    expect(shippingTotal < total).toBe(true)
  })
})

describe('the registry agrees with the migration: order_note', () => {
  it('is a nullable, human-editable TEXT field (§10.1)', () => {
    const field = ORDER_FIELDS.note
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('order_note')
    expect(field?.nullable).toBe(true)
    expect(field?.capabilities?.creatable).toBe(true)
    expect(field?.capabilities?.updatable).toBe(true)
  })

  it('is declared multiline', () => {
    expect(ORDER_FIELDS.note?.options).toMatchObject({ multiline: true })
  })
})

describe('migration 122: skips an org that has not reached `order` yet', () => {
  it('is a no-op — that org gets both fields from the registry at seed time instead', async () => {
    const db = fakeDb([]) // no EntityDefinition rows at all
    const result = await migration122OrderShippingAndNote.up(db, 'org_without_order')
    expect(result).toEqual({
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    })
  })
})
