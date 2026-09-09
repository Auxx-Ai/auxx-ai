// packages/lib/src/resources/registry/resources/refund-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * What happened to the goods on a refunded line
 * (plans/money/tasks/47-shopify-refunds.md §3, §9).
 *
 * 🛑 **Provider-neutral by construction, and this is load-bearing.** Shopify's
 * own token is `restock_type`; the vocabulary below is auxx's, and the
 * connector maps into it. Rule 1 of §9: no provider's vocabulary is ever stored
 * as a value. The cost of getting this backwards is on record - entity
 * migration 132 had to rename `1200 Shopify Clearing` to `1200 Card Clearing`
 * because a provider's name had been baked into the chart.
 *
 * The Shopify mapping, recorded here and nowhere in the data:
 *
 * | disposition | Shopify `restock_type` |
 * |---|---|
 * | `returned` | `return`, `legacy_restock` |
 * | `not_returned` | `no_restock` |
 * | `cancelled` | `cancel` |
 *
 * `not_returned` is a concession or allowance: the money went back and the
 * customer kept the goods. `cancelled` never shipped, which is why the
 * distinction matters to the entry builder - a cancellation before fulfillment
 * has no revenue to reverse, because none was ever posted (§3.1).
 */
export const REFUND_LINE_DISPOSITION_OPTIONS = [
  { label: 'Returned', value: 'returned', color: 'green' },
  { label: 'Not returned', value: 'not_returned', color: 'amber' },
  { label: 'Cancelled', value: 'cancelled', color: 'gray' },
] as const

/**
 * Field definitions for the Refund Line resource
 * (plans/money/tasks/47-shopify-refunds.md §2.2).
 *
 * The goods leg of a refund: one record per refunded line, projected out of
 * `refunds[].refund_line_items[]` as a fan-out under {@link REFUND_FIELDS}.
 *
 * The field set below comes from the measured payload keys - `[id, line_item,
 * line_item_id, location_id, quantity, restock_type, subtotal, subtotal_set,
 * total_tax, total_tax_set]` - not from guesswork. Two are deliberately absent:
 *
 * 🛑 **`restock` is NOT bound.** It is deprecated in favour of `restock_type`,
 * and it sits at the refund level where the fact is per line. It is in the
 * payload, so it will look bindable.
 *
 * 🔀 **`location_id` is deliberately omitted.** Nothing consumes which location
 * goods returned to until the inventory leg exists, and §5.3 defers that leg.
 * Add it with the leg, not before.
 *
 * Money is integer minor units, scaled through `decimalToMinorUnits` in the
 * projection (§4).
 */
export const REFUND_LINE_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'id',
    systemSortOrder: 'a0',
    showInPanel: false,
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true,
    operatorOverrides: ['is', 'is not', 'in', 'not in'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique refund line identifier',
  },

  /** How many units of the order line came off, bound from `quantity`. */
  qty: {
    id: toFieldId('qty'),
    key: 'qty',
    label: 'Qty',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'refund_line_qty',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'The quantity refunded on this line',
  },

  /**
   * The goods amount refunded on this line, in integer minor units.
   *
   * ⚠️ Bound from `subtotal_set.shop_money.amount`, the STRING form, for the
   * same reason {@link REFUND_LINE_FIELDS.taxTotal} is (§4.1): the `_set` form
   * is the one that carries a currency code, and it keeps every refund money
   * value on the single `decimalToMinorUnits` path.
   */
  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'refund_line_subtotal',
    systemSortOrder: 'a2',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units. The goods amount refunded on this line, bound from the ' +
      '_set.shop_money.amount string so it scales on the one money path',
  },

  /**
   * The tax reversed on this line, in integer minor units.
   *
   * 🛑 **Bind `total_tax_set.shop_money.amount`, the STRING. NEVER the sibling
   * `total_tax`, which is a NUMBER** (§4.1). The same object carries the same
   * value as two different types:
   *
   * ```
   * total_tax                        = 202.23     <- NUMBER
   * total_tax_set.shop_money.amount  = "202.23"   <- STRING
   * ```
   *
   * Every other money field on the refund is a string and goes through
   * `decimalToMinorUnits`. Binding the bare scalar opens a SECOND numeric code
   * path into the ledger, which is exactly where the 100x bug lived last time -
   * 139 Shopify money rows stored a hundredfold low (money plan 37 §2.4). The
   * `_set` form is also the only one that carries a currency code.
   *
   * 🛑 **Null is not zero, and they must not collapse** (§6.2a). The provider is
   * TRANSCRIBED and never prorated (§6.2), so with arithmetic ruled out there is
   * no way to derive a tax that was not supplied. Zero means *post no tax
   * reversal, this is correct*; null means *post no tax reversal and say so*,
   * because `2200` is then knowably overstated by an unknown amount. Shopify
   * answers zero on every adjustment on the measured store, which is a real
   * answer; another provider may answer nothing at all.
   */
  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'refund_line_tax_total',
    systemSortOrder: 'a3',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units, transcribed from the provider and never prorated. Bound from ' +
      'total_tax_set.shop_money.amount (a string), never the sibling total_tax (a number). ' +
      'Null means the provider supplied no tax, which is not the same as a supplied zero',
  },

  /**
   * What happened to the goods on this line. See
   * {@link REFUND_LINE_DISPOSITION_OPTIONS} for the values and the provider
   * mapping.
   *
   * This is `G16`'s "disposition" requirement, and it is what decides whether a
   * refund moves `stock_movement` or only reverses revenue. Null means the
   * provider said nothing, which is distinct from any of the three answers.
   */
  disposition: {
    id: toFieldId('disposition'),
    key: 'disposition',
    label: 'Disposition',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'refund_line_disposition',
    systemSortOrder: 'a4',
    nullable: true,
    options: { options: [...REFUND_LINE_DISPOSITION_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select disposition',
    description:
      'What happened to the goods: returned, kept (a concession), or never shipped. ' +
      'Provider-neutral - the connector maps its own vocabulary into these values',
  },

  /** The refund this line belongs to. The owning side of `refund_lines`. */
  refund: {
    id: toFieldId('refund'),
    key: 'refund',
    label: 'Refund',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'refund_line_refund',
    systemSortOrder: 'a5',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'refund:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'refund',
      relationshipType: 'belongs_to',
      inverseName: 'Refund Lines',
      inverseSystemAttribute: 'refund_lines',
    },
    description: 'The refund this line belongs to',
  },

  /**
   * The order line that came back, bound from `line_item_id` in `reference`
   * link mode: the line item already exists as its own record from the order
   * fan-out, so this points at it rather than restating it.
   */
  lineItem: {
    id: toFieldId('lineItem'),
    key: 'lineItem',
    label: 'Line Item',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'refund_line_line_item',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:refundLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'line_item',
      relationshipType: 'belongs_to',
      inverseName: 'Refund Lines',
      inverseSystemAttribute: 'line_item_refund_lines',
    },
    description: 'The order line item this refund line reversed',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'b0',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the refund line is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'b1',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the refund line is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
