// packages/lib/src/resources/registry/resources/credit-memo-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * What happened to the goods on a credited line
 * (plans/accounting/tasks/10-credit-memos.md §2.2, plans/money/tasks/47 §3, §9).
 *
 * Provider-neutral by construction, and this is load-bearing. Shopify's own
 * token is `restock_type`; the vocabulary below is auxx's, and the connector
 * maps into it. Rule 1 of 47 §9: no provider's vocabulary is ever stored as a
 * value. The cost of getting this backwards is on record - entity migration
 * 132 had to rename `1200 Shopify Clearing` to `1200 Card Clearing` because a
 * provider's name had been baked into the chart.
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
 * has no revenue to reverse, because none was ever posted. A `returned` line
 * does NOT move stock yet (§9); the field is kept so the inventory leg can be
 * added without a data migration.
 */
export const CREDIT_MEMO_LINE_DISPOSITION_OPTIONS = [
  { label: 'Returned', value: 'returned', color: 'green' },
  { label: 'Not returned', value: 'not_returned', color: 'amber' },
  { label: 'Cancelled', value: 'cancelled', color: 'gray' },
] as const

/**
 * Field definitions for the Credit Memo Line resource
 * (plans/accounting/tasks/10-credit-memos.md §2.2, §10.3).
 *
 * One record per credited line under `credit_memo_lines`, rendered by the line
 * builder. Native: from the invoice's line items, or a free-text concession
 * line with no line item. Channel: projected out of
 * `refunds[].refund_line_items[]`, plus ONE remainder line with no line item
 * that makes the memo total equal the amount refunded.
 *
 * Two payload keys are deliberately absent on the channel path. `restock` is
 * NOT bound: it is deprecated in favour of `restock_type`, and it sits at the
 * refund level where the fact is per line. `location_id` is omitted until the
 * inventory leg exists; add it with the leg, not before.
 *
 * Money is integer minor units, scaled through `decimalToMinorUnits` in the
 * projection.
 */
export const CREDIT_MEMO_LINE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique credit memo line identifier',
  },

  // Printed on the document. Defaults to the line item's name when linked;
  // the remainder line reads "Refund adjustment".
  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'credit_memo_line_description',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter description',
    description: "Printed on the document. Defaults to the line item's name when one is linked",
  },

  qty: {
    id: toFieldId('qty'),
    key: 'qty',
    label: 'Qty',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'credit_memo_line_qty',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: 1,
    description: 'The quantity credited on this line',
  },

  // A RATE, per each, like `line_item_unit_price`. Native: defaults to the
  // line item's price. Channel: subtotal / qty, or the whole subtotal for the
  // remainder line.
  unitPrice: {
    id: toFieldId('unitPrice'),
    key: 'unitPrice',
    label: 'Unit Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_line_unit_price',
    systemSortOrder: 'a3',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: RATE_DECIMALS,
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
      "Per-each rate. Native: defaults to the line item's price. Channel: subtotal divided " +
      'by qty, or the whole subtotal on the remainder line',
  },

  /**
   * The goods amount credited on this line, in integer minor units.
   *
   * On the channel path this is bound from `subtotal_set.shop_money.amount`,
   * the STRING form, for the same reason `taxTotal` is: the `_set` form is the
   * one that carries a currency code, and it keeps every money value on the
   * single `decimalToMinorUnits` path.
   */
  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_line_subtotal',
    systemSortOrder: 'a4',
    nullable: false,
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
      'Integer minor units. The goods amount credited on this line. Channel: bound from the ' +
      '_set.shop_money.amount string so it scales on the one money path',
  },

  /**
   * The tax reversed on this line, in integer minor units.
   *
   * Native: the invoice line's tax share, transcribed. Channel: bind
   * `total_tax_set.shop_money.amount`, the STRING. NEVER the sibling
   * `total_tax`, which is a NUMBER. The same object carries the same value as
   * two different types, and binding the bare scalar opens a SECOND numeric
   * code path into the ledger, which is exactly where the 100x bug lived
   * (money plan 37 §2.4).
   *
   * Null is not zero, and they must not collapse. Tax is TRANSCRIBED and never
   * prorated, so with arithmetic ruled out there is no way to derive a tax that
   * was not supplied. Zero means "post no tax reversal, this is correct"; null
   * means "post no tax reversal and say so", because `2200` is then knowably
   * overstated by an unknown amount.
   */
  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'credit_memo_line_tax_total',
    systemSortOrder: 'a5',
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
      'Integer minor units, transcribed and never prorated. Native: the invoice line tax ' +
      'share. Channel: bound from total_tax_set.shop_money.amount (a string), never the ' +
      'sibling total_tax (a number). Null means no tax was supplied, which is not the same ' +
      'as a supplied zero',
  },

  /**
   * What happened to the goods on this line. See
   * {@link CREDIT_MEMO_LINE_DISPOSITION_OPTIONS} for the values and the
   * provider mapping. Null means a concession or remainder line, which has no
   * goods, or a provider that said nothing.
   */
  disposition: {
    id: toFieldId('disposition'),
    key: 'disposition',
    label: 'Disposition',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'credit_memo_line_disposition',
    systemSortOrder: 'a6',
    nullable: true,
    options: { options: [...CREDIT_MEMO_LINE_DISPOSITION_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select disposition',
    description:
      'What happened to the goods: returned, kept (a concession), or never shipped. Null on ' +
      'a concession or remainder line. Provider-neutral - the connector maps its own ' +
      'vocabulary into these values',
  },

  /** The memo this line belongs to. The owning side of `credit_memo_lines`. */
  creditMemo: {
    id: toFieldId('creditMemo'),
    key: 'creditMemo',
    label: 'Credit Memo',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_line_credit_memo',
    systemSortOrder: 'a7',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'credit_memo:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'credit_memo',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'credit_memo_lines',
    },
    description: 'The credit memo this line belongs to',
  },

  /**
   * The invoice or order line being credited. Optional: a concession or
   * remainder line has none. On the channel path it is bound from
   * `line_item_id`, because the line item already exists as its own record
   * from the order fan-out.
   */
  lineItem: {
    id: toFieldId('lineItem'),
    key: 'lineItem',
    label: 'Line Item',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'credit_memo_line_line_item',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:creditMemoLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'line_item',
      relationshipType: 'belongs_to',
      inverseName: 'Credit Memo Lines',
      inverseSystemAttribute: 'line_item_credit_memo_lines',
    },
    description:
      'The invoice or order line item this line credits - optional, a concession or ' +
      'remainder line has none',
  },

  // What `LINE_SCHEMAS` sorts on, like `line_item_sort_order`.
  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'credit_memo_line_sort_order',
    systemSortOrder: 'a9',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
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
    description: 'Automatically set when the credit memo line is created',
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
    description: 'Automatically updated when the credit memo line is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
