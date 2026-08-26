// packages/lib/src/seed/entity-migrations/migrations/107-order.test.ts
//
// Migration 107 is helper composition (the 101/103 recipe) plus one hand-written
// step: the §3.2 rename-aside. The helpers have their own coverage, and the
// rename's DB behaviour lives in `107-order.int.test.ts` — real SQL is the only
// place claims like "the incumbent keeps entityType NULL" survive.
//
// What is pinned HERE is the wiring, because a new entity type touches eight
// hand-edited registries and a miss in any one of them is a no-op rather than
// an error, and `linkNewRelationships` resolves inverse pairs by string
// reference, so a typo in either direction links nothing and logs a debug line.
//
// The icon/color assertions are deliberate. `EntityDefinition.icon` holds an id
// from a CURATED registry, not a Lucide name, and `getIcon` returns undefined
// for an unknown id while `EntityIcon` then renders nothing at all — which is
// exactly how `product` shipped with `package-2` and no icon.

import { FieldType, ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
import { isSystemAttribute } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import {
  LINE_TOTAL_TRIGGER_ATTRS,
  LINE_TRIGGER_ATTRS,
  ORDER_TRIGGER_ATTRS,
} from '../../../money/totals-hooks'
import {
  OrderChannel,
  OrderFinancialStatus,
  OrderFulfillmentStatus,
} from '../../../resources/registry/enum-values'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { WORK_ORDER_FIELDS } from '../../../resources/registry/resources/work-order-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { FIELD_REGISTRY } from '../../entity-seeder/create-fields'
import { migration107Order } from './107-order'

describe('migration 107 registration', () => {
  it('is registered exactly once, after 106, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '107-order')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('107-order')).toBe(ids.indexOf('106-supplier-pricing-relabel') + 1)
    expect(migration107Order.id).toBe('107-order')
  })
})

describe('order entity registration wiring', () => {
  it('every ORDER_FIELDS systemAttribute is in the SystemAttribute union', () => {
    for (const [key, field] of Object.entries(ORDER_FIELDS)) {
      expect(field.systemAttribute, `${key} has no systemAttribute`).toBeTruthy()
      expect(
        isSystemAttribute(field.systemAttribute!),
        `${key}: '${field.systemAttribute}' missing from @auxx/types/system-attribute`
      ).toBe(true)
    }
  })

  it('carries exactly the 08 §2 field set', () => {
    expect(Object.keys(ORDER_FIELDS).sort()).toEqual([
      'channel',
      'company',
      'contact',
      'createdAt',
      'createdBy',
      'currency',
      'discountType',
      'discountValue',
      'financialStatus',
      'fulfillmentStatus',
      'id',
      'lineItems',
      'number',
      'paymentGateways',
      'placedAt',
      'shippingAddress',
      'subtotal',
      'tags',
      'taxName', // added by migration 109 — the LineBuilder writes it with taxRate
      'taxRate',
      'taxTotal',
      'total',
      'updatedAt',
      'workOrders',
    ])
  })

  it('is registered in both field registries, ModelTypeValues and SYSTEM_ENTITIES', () => {
    expect(RESOURCE_FIELD_REGISTRY.order).toBe(ORDER_FIELDS)
    expect(FIELD_REGISTRY.order).toBe(ORDER_FIELDS)
    expect(ModelTypeValues).toContain('order')
    expect(ModelTypeMeta.order).toEqual({
      label: 'Order',
      plural: 'Orders',
      icon: 'shopping-bag',
      color: 'amber',
      apiSlug: 'orders',
      dbTable: 'EntityInstance',
      hasDetailPage: true,
    })

    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'order')
    expect(entity).toMatchObject({
      apiSlug: 'orders',
      singular: 'Order',
      plural: 'Orders',
      icon: 'shopping-bag',
      color: 'amber',
      isVisible: true,
    })
  })

  // NOTE: the real check — "does this id exist in @auxx/ui's ICON_DATA?" —
  // cannot live here. `@auxx/lib` is tier 3 and must never import `@auxx/ui`.
  // `shopping-bag` was verified against `icon-data.ts:329` by hand on
  // 2026-08-26; a cross-package test in apps/web is what would catch a
  // regression, and it still does not exist.
  it('uses an icon id that is in the curated registry', () => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'order')!
    expect(entity.icon).toBe('shopping-bag')
    expect(ModelTypeMeta.order.icon).toBe(entity.icon)
  })

  it('uses a colour id that is a real ICON_COLORS entry', () => {
    const VALID_COLORS = [
      'gray',
      'red',
      'orange',
      'amber',
      'green',
      'emerald',
      'teal',
      'blue',
      'indigo',
      'purple',
      'pink',
    ]
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'order')!
    expect(VALID_COLORS).toContain(entity.color)
    expect(VALID_COLORS).toContain(ModelTypeMeta.order.color)
  })

  it('display fields resolve against real ORDER_FIELDS keys', () => {
    const config = DISPLAY_FIELD_CONFIG.order
    expect(config?.primaryDisplayField).toBe('number')
    expect(ORDER_FIELDS[config!.primaryDisplayField]).toBeDefined()
  })
})

describe('order field shapes the plan is explicit about', () => {
  // 08 §5.2: every system entity that has an address uses ADDRESS_STRUCT.
  // Not one registry field uses the bare ADDRESS type; 03 §3 said ADDRESS and
  // was corrected.
  it('shippingAddress is ADDRESS_STRUCT, not the bare ADDRESS type', () => {
    expect(ORDER_FIELDS.shippingAddress?.fieldType).toBe(FieldType.ADDRESS_STRUCT)
    expect(ORDER_FIELDS.shippingAddress?.fieldType).not.toBe(FieldType.ADDRESS)
  })

  // 08 §4 / D18. An earlier design derived it at ingest; that cannot handle a
  // manual sale, which has no payment gateways and no tags to derive from.
  it('channel is human-set — writable, and offers the manual value', () => {
    expect(ORDER_FIELDS.channel?.capabilities?.creatable).toBe(true)
    expect(ORDER_FIELDS.channel?.capabilities?.updatable).toBe(true)
    expect(OrderChannel.values.map((v) => v.value)).toEqual(['dtc', 'dealer', 'manual'])
  })

  it('the three totals are CURRENCY and writable only by the totals engine', () => {
    for (const key of ['subtotal', 'taxTotal', 'total']) {
      const field = ORDER_FIELDS[key]
      expect(field?.fieldType, key).toBe(FieldType.CURRENCY)
      expect(field?.capabilities?.creatable, key).toBe(false)
      expect(field?.capabilities?.updatable, key).toBe(false)
    }
  })

  it('number is RecordSequence-issued, never user-written', () => {
    expect(ORDER_FIELDS.number?.systemAttribute).toBe('order_number')
    expect(ORDER_FIELDS.number?.capabilities?.creatable).toBe(false)
    expect(ORDER_FIELDS.number?.capabilities?.updatable).toBe(false)
  })

  it('tags reuses the shared open-tag `category` attribute, not a new vocabulary', () => {
    expect(ORDER_FIELDS.tags?.systemAttribute).toBe('category')
    expect(ORDER_FIELDS.tags?.systemAttribute).toBe(PART_FIELDS.category?.systemAttribute)
  })

  // 08 §6.4 / D16 — locked: margin comes from Gap C's frozen
  // `stock_movement.unitCost` at fulfillment grain, never a cost on the line.
  it('carries no cost field — D16 keeps cost on the movement ledger', () => {
    const attrs = Object.values(ORDER_FIELDS).map((f) => f.systemAttribute)
    expect(attrs.some((a) => a?.includes('cost'))).toBe(false)
  })
})

describe('order enums', () => {
  it('financialStatus is the six-value money vocabulary', () => {
    expect(OrderFinancialStatus.values.map((v) => v.value)).toEqual([
      'pending',
      'authorized',
      'paid',
      'partially_refunded',
      'refunded',
      'voided',
    ])
  })

  it('fulfillmentStatus is the four-value shipping vocabulary', () => {
    expect(OrderFulfillmentStatus.values.map((v) => v.value)).toEqual([
      'unfulfilled',
      'partial',
      'fulfilled',
      'restocked',
    ])
  })

  it('field options are wired to the enum value lists, not re-declared', () => {
    expect(ORDER_FIELDS.financialStatus?.options).toEqual({
      options: OrderFinancialStatus.values,
    })
    expect(ORDER_FIELDS.fulfillmentStatus?.options).toEqual({
      options: OrderFulfillmentStatus.values,
    })
    expect(ORDER_FIELDS.channel?.options).toEqual({ options: OrderChannel.values })
  })
})

describe('relationship pairs', () => {
  // `linkNewRelationships` looks the inverse up by this exact string in the
  // merged field map — a mismatch on either side is a silent no-link.
  it('order.contact ↔ contact.orders point at each other', () => {
    expect(ORDER_FIELDS.contact?.relationship).toMatchObject({
      inverseResourceFieldId: 'contact:orders',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(CONTACT_FIELDS.orders?.relationship).toMatchObject({
      inverseResourceFieldId: 'order:contact',
      relationshipType: 'has_many',
      isInverse: true,
    })
    expect(ORDER_FIELDS.contact?.relationshipConfig?.inverseSystemAttribute).toBe(
      CONTACT_FIELDS.orders?.systemAttribute
    )
    expect(ORDER_FIELDS.contact?.systemAttribute).toBe('order_contact')
    expect(ORDER_FIELDS.contact?.nullable).toBe(false)
  })

  it('order.company ↔ company.orders point at each other, and company is nullable', () => {
    expect(ORDER_FIELDS.company?.relationship).toMatchObject({
      inverseResourceFieldId: 'company:orders',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(COMPANY_FIELDS.orders?.relationship).toMatchObject({
      inverseResourceFieldId: 'order:company',
      relationshipType: 'has_many',
      isInverse: true,
    })
    expect(ORDER_FIELDS.company?.relationshipConfig?.inverseSystemAttribute).toBe(
      COMPANY_FIELDS.orders?.systemAttribute
    )
    expect(ORDER_FIELDS.company?.systemAttribute).toBe('order_company')
    expect(ORDER_FIELDS.company?.nullable).toBe(true)
  })

  it('order.workOrders ↔ work_order.order point at each other', () => {
    expect(ORDER_FIELDS.workOrders?.relationship).toMatchObject({
      inverseResourceFieldId: 'work_order:order',
      relationshipType: 'has_many',
      isInverse: true,
    })
    expect(WORK_ORDER_FIELDS.order?.relationship).toMatchObject({
      inverseResourceFieldId: 'order:workOrders',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(WORK_ORDER_FIELDS.order?.relationshipConfig?.inverseSystemAttribute).toBe(
      ORDER_FIELDS.workOrders?.systemAttribute
    )
    expect(WORK_ORDER_FIELDS.order?.systemAttribute).toBe('work_order_order')
    expect(WORK_ORDER_FIELDS.order?.nullable).toBe(true)
  })
})

describe('the two new line_item slots', () => {
  it('every new systemAttribute is in the SystemAttribute union', () => {
    for (const attr of ['line_item_order', 'line_item_part', 'part_line_items']) {
      expect(isSystemAttribute(attr), `'${attr}' missing from @auxx/types/system-attribute`).toBe(
        true
      )
    }
  })

  it('line_item.order ↔ order.lineItems point at each other', () => {
    expect(LINE_ITEM_FIELDS.order?.systemAttribute).toBe('line_item_order')
    expect(LINE_ITEM_FIELDS.order?.fieldType).toBe(FieldType.RELATIONSHIP)
    expect(LINE_ITEM_FIELDS.order?.relationship).toMatchObject({
      inverseResourceFieldId: 'order:lineItems',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    // This is the half 107 left dangling — it only links once the line above exists.
    expect(ORDER_FIELDS.lineItems?.relationship?.inverseResourceFieldId).toBe('line_item:order')
  })

  it('line_item.part ↔ part.lineItems point at each other', () => {
    expect(LINE_ITEM_FIELDS.part?.systemAttribute).toBe('line_item_part')
    expect(LINE_ITEM_FIELDS.part?.relationship).toMatchObject({
      inverseResourceFieldId: 'part:lineItems',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(PART_FIELDS.lineItems?.systemAttribute).toBe('part_line_items')
    expect(PART_FIELDS.lineItems?.relationship).toMatchObject({
      inverseResourceFieldId: 'line_item:part',
      relationshipType: 'has_many',
      isInverse: true,
    })
  })

  // `linkNewRelationships` splits the reference on ':' and looks the prefix up in
  // the entityDefIds map, so the prefix must be an entityType, not an apiSlug.
  it('names its counterparts by entityType, not apiSlug', () => {
    const refs = [
      LINE_ITEM_FIELDS.order!.relationship!.inverseResourceFieldId,
      LINE_ITEM_FIELDS.part!.relationship!.inverseResourceFieldId,
      PART_FIELDS.lineItems!.relationship!.inverseResourceFieldId,
      ORDER_FIELDS.lineItems!.relationship!.inverseResourceFieldId,
    ] as string[]
    expect(refs.map((r) => r.split(':')[0])).toEqual(['order', 'part', 'line_item', 'line_item'])
  })

  it('the four document slots carry distinct, ordered sort keys', () => {
    const keys = (['quote', 'workOrder', 'invoice', 'order'] as const).map(
      (k) => LINE_ITEM_FIELDS[k]!.systemSortOrder!
    )
    expect(new Set(keys).size).toBe(4)
    expect([...keys].sort()).toEqual(keys)
  })
})

describe('totals trigger vocabulary', () => {
  it('ORDER_TRIGGER_ATTRS is the order’s own billing fields', () => {
    expect([...ORDER_TRIGGER_ATTRS].sort()).toEqual([
      'order_discount_type',
      'order_discount_value',
      'order_tax_rate',
    ])
  })

  it('attaching a line to an order recomputes that order', () => {
    expect(LINE_TRIGGER_ATTRS.has('line_item_order')).toBe(true)
  })

  // 08 §2 said to add BOTH new rels here. `line_item_part` is deliberately left
  // out: §6.2 is explicit that part is provenance and grouping, never a pricing
  // input, so it cannot move a total. Including it would make phase 4’s stamp
  // hook trigger a full document recompute on every line it touches, for a
  // number that cannot have changed.
  it('stamping a part does NOT recompute — part is not a pricing input', () => {
    expect(LINE_TRIGGER_ATTRS.has('line_item_part')).toBe(false)
  })

  it('no trigger attr is one the engine itself writes — that would recurse', () => {
    for (const written of [
      'line_item_line_total',
      'order_subtotal',
      'order_tax_total',
      'order_total',
    ]) {
      expect(LINE_TRIGGER_ATTRS.has(written as never)).toBe(false)
      expect(ORDER_TRIGGER_ATTRS.has(written as never)).toBe(false)
    }
    // qty/unitPrice are the only two that also rewrite the line's own total.
    expect([...LINE_TOTAL_TRIGGER_ATTRS].sort()).toEqual(['line_item_qty', 'line_item_unit_price'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// order.taxName — folded into 108 rather than given its own id. The "a change
// needs a NEW migration id" rule in 08 §7.1 is about migration 107, which is
// MERGED and already `applied` across 28 orgs: editing it would silently skip
// every environment that already ran it. 108 is unmerged and has never reached
// a deployed environment, so it is still free to change — `run-migration-108.ts`
// re-applies it on dev, idempotently.
// ─────────────────────────────────────────────────────────────────────────────

describe('order.taxName', () => {
  it('is a TEXT field on the SystemAttribute union', () => {
    expect(ORDER_FIELDS.taxName?.systemAttribute).toBe('order_tax_name')
    expect(ORDER_FIELDS.taxName?.fieldType).toBe(FieldType.TEXT)
    expect(isSystemAttribute('order_tax_name')).toBe(true)
  })

  it('is writable — the line builder sets it when a tax preset is picked', () => {
    expect(ORDER_FIELDS.taxName?.capabilities?.creatable).toBe(true)
    expect(ORDER_FIELDS.taxName?.capabilities?.updatable).toBe(true)
  })

  // The real invariant: the shared `LineBuilder.updateTax` writes
  // `${prefix}_tax_name` AND `${prefix}_tax_rate` together, and `TotalsFooter`
  // matches the stored pair back against `documents.taxRates` to decide which
  // preset is selected. A document with the rate and no name always reads back
  // as "Custom" and silently drops half of every write.
  it('every totalled document carries BOTH halves of the tax snapshot', () => {
    const documents = [
      { name: 'quote', fields: QUOTE_FIELDS, prefix: 'quote' },
      { name: 'invoice', fields: INVOICE_FIELDS, prefix: 'invoice' },
      { name: 'order', fields: ORDER_FIELDS, prefix: 'order' },
    ]
    for (const { name, fields, prefix } of documents) {
      const attrs = Object.values(fields).map((f) => f.systemAttribute)
      expect(attrs, `${name} is missing ${prefix}_tax_name`).toContain(`${prefix}_tax_name`)
      expect(attrs, `${name} is missing ${prefix}_tax_rate`).toContain(`${prefix}_tax_rate`)
    }
  })

  it('sorts next to taxRate rather than at the end of the panel', () => {
    const taxName = ORDER_FIELDS.taxName?.systemSortOrder ?? ''
    const taxRate = ORDER_FIELDS.taxRate?.systemSortOrder ?? ''
    const discountValue = ORDER_FIELDS.discountValue?.systemSortOrder ?? ''
    expect(discountValue < taxName).toBe(true)
    expect(taxName < taxRate).toBe(true)
  })
})
