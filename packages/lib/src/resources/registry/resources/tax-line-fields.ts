// packages/lib/src/resources/registry/resources/tax-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Tax Line resource - one jurisdiction's share of one
 * order's tax, exactly as the sales channel computed it
 * (plans/money/tasks/48-shopify-tax-data.md §4.1).
 *
 * ## 🛑 auxx does not calculate tax, and this entity is not a step towards it
 *
 * 48's banner and `plans/accounting/gap-analysis.md` §5.2 settle it: US sales
 * tax is state + county + city + special district with product-level
 * taxability, exemption certificates, nexus thresholds and filing calendars,
 * and nobody builds it, QuickBooks included. The provider has ALREADY computed
 * the tax. These rows CARRY that answer. Any arithmetic that derives an amount
 * from {@link TAX_LINE_FIELDS.rate} is out of scope by construction.
 *
 * ## Why this is a record and not a rate on the order
 *
 * `order_tax_rate` exists and is deliberately unbound. 48 §2 measured why: of
 * 123 taxed orders in one 250-order window, **104 carried more than one tax
 * line - 85%**. A single scalar rate can represent 19 of 123, and binding it
 * would be worse than leaving it empty, because a partial answer reads as a
 * complete one. Nine states plus special districts appeared in that one window.
 *
 * Multi-jurisdiction is the NORM, so the breakdown has to be rows. The purpose
 * is *tax by jurisdiction over a period*, which is an aggregation, and an
 * aggregation wants rows - a JSON blob would store the data and answer none of
 * the questions it was stored for.
 *
 * ⚠️ Not every row is a tax. `Colorado Retail Delivery Fee` is a flat
 * per-delivery fee with its own remittance rules and it arrives in the same
 * array, one of them carrying a rate of literally `0`. The jurisdiction name is
 * what preserves the distinction (48 §6.3).
 *
 * ## Additive by construction
 *
 * `sum(tax_lines.price) == total_tax` held on **250 of 250** orders measured,
 * so these rows tie to the `order_tax_total` already being imported. Nothing
 * that posts today changes when they land.
 *
 * `EntityInstance`-backed, no new Drizzle tables - the `line_item` and
 * `purchase_order_line` precedent. Money is integer minor units
 * ({@link TAX_LINE_FIELDS.price}).
 */
export const TAX_LINE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique tax line identifier',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tax_line_title',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'CA State Tax',
    description:
      'The JURISDICTION this line is owed to, as the provider named it - "Texas State Tax", ' +
      '"Ventura Co Local Tax Sl", "Dallas Mta Transit". It is what a tax-by-jurisdiction ' +
      'report groups by, and the only thing that distinguishes a genuine tax from a fee ' +
      'riding in the same array, such as the Colorado Retail Delivery Fee',
  },

  rate: {
    id: toFieldId('rate'),
    key: 'rate',
    label: 'Rate',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'tax_line_rate',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The rate exactly as the provider supplied it. 🛑 NEVER used to compute anything - ' +
      'auxx does not calculate tax, and the amount is carried on price. Display and filing ' +
      'only. A flat fee can legitimately arrive with a rate of 0, which is another reason ' +
      'the amount is never derived from this',
  },

  // 🛑 Bind `price_set.shop_money.amount` (a STRING), never the bare numeric
  // sibling (48 §8.1, measured 2026-09-08). The same Shopify object carries the
  // same value as two different types: `total_tax = 202.23` is a NUMBER while
  // `total_tax_set.shop_money.amount = "202.23"` is a STRING. "Shopify sends
  // decimals as strings" is NOT uniformly true. The `_set` form is the shape
  // `decimalToMinorUnits` already expects, it is what every other money binding
  // uses, and it is the only one carrying a currency code. Binding the bare
  // scalar opens a second numeric path into the ledger, which is where the 100x
  // bug lived (money plan 37 §2.4, 139 rows).
  //
  // 🛑 And no default. 48 §8.2: "not supplied" and "supplied as zero" are
  // DIFFERENT states - a null FieldValue against a row holding 0. Both post
  // nothing, which is exactly why they get collapsed if nobody writes it down,
  // and collapsing them turns a flagged gap into a silent one.
  price: {
    id: toFieldId('price'),
    key: 'price',
    label: 'Price',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'tax_line_price',
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
      'Integer minor units. The tax this jurisdiction charged on this order, as computed ' +
      'by the provider and never by us',
  },

  // 🛑 `channelLiable` is the one field on this record the LEDGER BRANCHES ON
  // (48 §3, answered in §6.4). Crediting a `channel_liable: true` line to
  // `2200 Sales Tax Payable` books a liability the business does not owe and
  // will never pay down: it balances, it looks right, and the account grows
  // forever.
  //
  // Counted 2026-09-08 over 250 orders: 1,212 lines / $59,941.96 are
  // channel-liable FALSE (we remit) against 6 lines / $272.08 TRUE (the channel
  // remits). 0.5% of lines is precisely the frequency at which nobody catches
  // it by eye, and the error grows with every marketplace order.
  //
  // The true lines still get rows - the money was collected and it is part of
  // the order total - they simply create no liability for this business.
  //
  // ⚠️ No default value, deliberately. Defaulting an unsupplied flag to false
  // is the same silent overstatement arrived at from the other direction: it
  // would credit 2200 for a provider that never told us who remits.
  channelLiable: {
    id: toFieldId('channelLiable'),
    key: 'channelLiable',
    label: 'Channel Liable',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'tax_line_channel_liable',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Whether a marketplace facilitator remits this tax instead of the merchant. 🛑 A ' +
      'POSTING INPUT, not decoration: only a false line credits 2200 Sales Tax Payable. A ' +
      'true line means the channel already remitted it and this business owes nothing',
  },

  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tax_line_order',
    systemSortOrder: 'a5',
    showInPanel: false, // tax lines are read in the context of their order
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:taxLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Tax Lines',
      inverseSystemAttribute: 'order_tax_lines',
    },
    description:
      'The order this jurisdiction charged. Fanned out of the order payload the way ' +
      'line items already are; a tax line has no life of its own',
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
    description: 'Automatically set when the tax line is created',
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
    description: 'Automatically updated when the tax line is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
