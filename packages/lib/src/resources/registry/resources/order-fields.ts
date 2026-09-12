// packages/lib/src/resources/registry/resources/order-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { OrderChannel, OrderFinancialStatus, OrderFulfillmentStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Percent-of-subtotal vs flat-amount discount — the same two values the quote
 * and the invoice carry. Declared locally rather than in `enum-values.ts`
 * because it is a money-document convention shared by all three documents, not
 * order vocabulary (`QUOTE_DISCOUNT_TYPE_OPTIONS` / `INVOICE_DISCOUNT_TYPE_OPTIONS`
 * are the precedent).
 */
const ORDER_DISCOUNT_TYPE_OPTIONS = [
  { label: 'Percent', value: 'percent', color: 'blue' },
  { label: 'Amount', value: 'amount', color: 'purple' },
] as const

/**
 * Field definitions for the Order resource — the third **totalled** money
 * document beside `quote` and `invoice` (plans/products/08-order-build.md §2).
 *
 * An order records **what was sold** — placed, paid, fulfilled — as distinct
 * from `work_order`, which records what was done. `work_order` has no totals
 * at all, so `order` is the third totalled document, not the fourth.
 *
 * Visible system def with `hasDetailPage: true` (08 §5.7, D17) — the `quote`
 * shape rather than the invoice's drawer-only one. An order links to work
 * orders and is the natural read surface for revenue-by-product, both of which
 * are page-shaped.
 *
 * Money is stored in **integer minor units** (`subtotal`, `taxTotal`, `total`)
 * and written only by the totals engine.
 */
export const ORDER_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique order identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'order_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // RecordSequence-issued (08 §5.3) — the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated order number — RecordSequence scope `order`, prefix `ORD`',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_contact',
    systemSortOrder: 'a2',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'contact:orders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Orders',
      inverseSystemAttribute: 'contact_orders',
    },
    description: 'Customer contact for this order — required, the buying party',
  },

  company: {
    id: toFieldId('company'),
    key: 'company',
    label: 'Company',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_company',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'company:orders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'company',
      relationshipType: 'belongs_to',
      inverseName: 'Orders',
      inverseSystemAttribute: 'company_orders',
    },
    description: 'Company this order was placed by — optional, a DTC sale has none',
    showInTable: false,
  },

  placedAt: {
    id: toFieldId('placedAt'),
    key: 'placedAt',
    label: 'Placed',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'order_placed_at',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select date placed',
    description: 'When the order was placed — the period key every revenue read groups on',
  },

  cancelledAt: {
    id: toFieldId('cancelledAt'),
    key: 'cancelledAt',
    label: 'Cancelled',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'order_cancelled_at',
    systemSortOrder: 'a4a',
    nullable: true,
    // Meaningful when set, so it stays in the panel — but you do not cancel an
    // order by typing a date into a create dialog
    // (plans/products/build/01-build-plan.md §1.6).
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      // `creatable: true` on purpose: a Shopify order can arrive ALREADY
      // cancelled, so the value has to be settable on the insert rather than
      // requiring a second write (plans/products/12 §6.1a).
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select date cancelled',
    description:
      'When the order was cancelled. Set, never cleared — the cancellation rule reads it to ' +
      'cancel or reverse the builds this order caused',
  },

  financialStatus: {
    id: toFieldId('financialStatus'),
    key: 'financialStatus',
    label: 'Financial Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'order_financial_status',
    systemSortOrder: 'a5',
    nullable: true,
    options: { options: OrderFinancialStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select financial status',
    description: 'Where the order sits on the money side',
    defaultValue: 'pending',
  },

  fulfillmentStatus: {
    id: toFieldId('fulfillmentStatus'),
    key: 'fulfillmentStatus',
    label: 'Fulfillment Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'order_fulfillment_status',
    systemSortOrder: 'a6',
    nullable: true,
    options: { options: OrderFulfillmentStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select fulfillment status',
    description: 'Where the order sits on the shipping side',
    defaultValue: 'unfulfilled',
  },

  channel: {
    id: toFieldId('channel'),
    key: 'channel',
    label: 'Channel',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'order_channel',
    systemSortOrder: 'a7',
    nullable: true,
    options: { options: OrderChannel.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select channel',
    description:
      'Which route the sale came in through — HUMAN-SET, never derived (08 §4, D18). A ' +
      'manual sale has no payment gateways and no tags to derive it from. The fulfillment ' +
      'posting books an unset or manual channel as consumer revenue; only "dealer" moves it ' +
      'to the dealer revenue line.',
    defaultValue: 'manual',
    showInTable: false,
  },

  paymentGateways: {
    id: toFieldId('paymentGateways'),
    key: 'paymentGateways',
    label: 'Payment Gateways',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    systemAttribute: 'order_payment_gateways',
    systemSortOrder: 'a8',
    nullable: true,
    options: { options: [] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Add payment gateways',
    description: 'Gateways that took money for this order — one order can use several',
    showInPanel: false,
  },

  currency: {
    id: toFieldId('currency'),
    key: 'currency',
    label: 'Currency',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'order_currency',
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'USD',
    description: 'ISO 4217 code the money fields are denominated in',
    showInPanel: false,
  },

  shippingAddress: {
    id: toFieldId('shippingAddress'),
    key: 'shippingAddress',
    label: 'Shipping Address',
    type: BaseType.OBJECT,
    // ADDRESS_STRUCT, not the bare ADDRESS type — every system entity that has
    // an address uses ADDRESS_STRUCT (08 §5.2). Not one registry field uses ADDRESS.
    fieldType: FieldType.ADDRESS_STRUCT,
    isSystem: true,
    systemAttribute: 'order_shipping_address',
    systemSortOrder: 'aA',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Where the order ships to',
    showInTable: false,
  },

  tags: {
    id: toFieldId('tags'),
    key: 'tags',
    label: 'Tags',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    // The shared open-tag attribute, as on `part` and `product` — not a new one.
    systemAttribute: 'category',
    systemSortOrder: 'aB',
    nullable: true,
    options: { options: [] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Add tags',
    description: 'Tags for this order',
    showInTable: false,
  },

  // Added by migration 122 (money plan 37 §8/§10.1). A merchant's delivery
  // instruction is a fact that exists without any connector — `D8` — so it is
  // a system field, not an app field. `mergeStrategy: 'fill_blank'` on the
  // Shopify binding (money plan 37 §6.1) means a note typed in auxx survives a
  // resync; this field itself carries no merge policy of its own.
  note: {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'order_note',
    systemSortOrder: 'aB1',
    showInTable: false,
    nullable: true,
    options: { multiline: true, rows: 2 },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Delivery instructions or other notes for this order',
    description: '',
  },

  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'order_subtotal',
    systemSortOrder: 'aC',
    showInPanel: false, // shown in the line-items overview card
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
      creatable: false, // totals engine is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Sum of line totals, integer minor units — written by the totals engine hook',
  },

  discountType: {
    id: toFieldId('discountType'),
    key: 'discountType',
    label: 'Discount Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'order_discount_type',
    systemSortOrder: 'aD',
    showInPanel: false, // shown in the line-items overview card
    nullable: true,
    options: { options: [...ORDER_DISCOUNT_TYPE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select discount type',
    description: 'Null = no discount',
  },

  discountValue: {
    id: toFieldId('discountValue'),
    key: 'discountValue',
    label: 'Discount Value',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'order_discount_value',
    systemSortOrder: 'aE',
    showInPanel: false, // shown in the line-items overview card
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  // The tax-preset snapshot's NAME, beside `taxRate`'s number. 08 §2's field
  // table omitted it, but the shared `LineBuilder` writes `${prefix}_tax_name`
  // and `${prefix}_tax_rate` together when a preset is picked
  // (`line-builder.tsx` updateTax) and `TotalsFooter` matches the stored pair
  // back to a preset to decide which option is selected — with only the rate,
  // an order can never show a named tax and always reads as "Custom".
  // `quote_tax_name` / `invoice_tax_name` are the precedent.
  taxName: {
    id: toFieldId('taxName'),
    key: 'taxName',
    label: 'Tax Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'order_tax_name',
    systemSortOrder: 'aE1',
    showInPanel: false, // shown in the line-items overview card
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: "Snapshot of the picked tax rate's name (documents.taxRates)",
  },

  taxRate: {
    id: toFieldId('taxRate'),
    key: 'taxRate',
    label: 'Tax Rate',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'order_tax_rate',
    systemSortOrder: 'aF',
    showInPanel: false, // shown in the line-items overview card
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Snapshot of the picked tax rate, percent (e.g. 7.5)',
  },

  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'order_tax_total',
    systemSortOrder: 'aG',
    showInPanel: false, // shown in the line-items overview card
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
      creatable: false, // totals engine is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Integer minor units — written by the totals engine hook',
  },

  // Added by migration 122 (money plan 37 §6/§8). Modelled exactly on
  // `purchase_order_shipping_total`: a STATED header amount, human-typed or
  // transcribed from a connector's own total, and folded into `total` by the
  // totals engine rather than derived from the lines. Sell-side documents had
  // no shipping term before this — quote and invoice still don't (money plan
  // 37 §11 keeps them out of scope).
  shippingTotal: {
    id: toFieldId('shippingTotal'),
    key: 'shippingTotal',
    label: 'Shipping Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'order_shipping_total',
    systemSortOrder: 'aG1',
    showInPanel: false, // shown in the line-items overview card
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
    placeholder: 'Shipping charged on this order',
    description:
      'Shipping for the whole order, integer minor units — a stated header amount that folds ' +
      'into the total, not derived from the lines',
  },

  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'order_total',
    systemSortOrder: 'aH',
    showInPanel: false, // shown in the line-items overview card
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
      creatable: false, // totals engine is the only writer
      updatable: false,
      configurable: false,
    },
    description: 'Integer minor units — written by the totals engine hook',
  },

  // Reverse relationship: lineItems (from line_item.order). The `line_item`
  // side lands with the money phase (08 §7 phase 2); until it does,
  // `linkNewRelationships` leaves this unlinked and links it when the
  // counterpart appears.
  lineItems: {
    id: toFieldId('lineItems'),
    key: 'lineItems',
    label: 'Line Items',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_line_items',
    systemSortOrder: 'aI',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'Line items on this order',
  },

  // Reverse relationship: workOrders (from work_order.order). The manual link
  // standing in for D4's deferred order → work-order conversion flow.
  workOrders: {
    id: toFieldId('workOrders'),
    key: 'workOrders',
    label: 'Work Orders',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_work_orders',
    systemSortOrder: 'aJ',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'work_order:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    },
    description: 'Work orders raised off this order — linked by hand (D4 defers the conversion)',
  },

  // Reverse relationship: builds (from build.order). The `build` side lands
  // with entity migration 109; both halves are created in that one pass, so
  // `linkNewRelationships` resolves this immediately.
  builds: {
    id: toFieldId('builds'),
    key: 'builds',
    label: 'Builds',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_builds',
    systemSortOrder: 'aK',
    showInPanel: false, // has_many inverse; surfaced from the build side
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'build:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    },
    description:
      'Builds raised to satisfy this order — what "cancel the builds for this order" looks up',
  },

  /**
   * The shipment records: one `fulfillment` per dispatch `money.fulfillOrder`
   * (or a channel connector) creates (plans/money/tasks/55-shipment-lines.md).
   *
   * 🛑 **This is the ONLY thing that makes "how much of this line is still to
   * ship" answerable.** `order_fulfillment_status` says `partial` and cannot
   * say partial in WHAT, and the ledger's own copy is the recognised AMOUNT,
   * not the quantity. Without this field a second fulfillment could re-ship a
   * line the first one already shipped and re-recognise its revenue - an entry
   * that balances and overstates the P&L with nothing to detect it.
   *
   * 🔑 **Same name, new type.** Entity migration 153 DROPS the old JSON field
   * of this exact name and recreates it as a RELATIONSHIP has_many, the
   * inverse of `fulfillment_order`. The JSON choice was reasoned from two
   * premises this migration invalidates: "a shipment has no independent
   * identity" (Shopify assigns every fulfillment an id) and "nothing links to
   * it" (`stock_movement` now does, via `stock_movement_fulfillment_line` -
   * that link is the whole of task 50's inventory-relief netting). Revenue
   * posts from these records now, not from a collapsed min/max/sum over a
   * JSON array - see `fulfillment-fields.ts` for what replaced it.
   *
   * `cascade`, unlike `shipments` below: a fulfillment is fanned out of THIS
   * order's own dispatch history and has no life without it, the same reason
   * `creditMemos` cascades and `shipments` (ShipStation's own record) does
   * not.
   */
  fulfillments: {
    id: toFieldId('fulfillments'),
    key: 'fulfillments',
    label: 'Fulfillments',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_fulfillments',
    systemSortOrder: 'aK1',
    showInPanel: false, // has_many inverse; surfaced from the fulfillment side
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'fulfillment:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description:
      'The dispatch records for this order - one per fulfillment, replacing the old JSON ' +
      'shipment log under the same name (entity migration 153)',
  },

  /**
   * The order's CURRENT production-demand fingerprint (plans/products/13 Model A+).
   *
   * Maintained by `builds/drift-reconciler.ts` and compared against a build's
   * `build_order_revision` to answer "has this order changed since its builds
   * were raised". Opaque — a SHA-256 hex string, never parsed, only compared.
   *
   * `updatable: false` and `creatable: false`: the reconciler is the only writer,
   * and a hand-typed value would silence the drift signal on exactly the order
   * somebody was looking at.
   */
  buildRevision: {
    id: toFieldId('buildRevision'),
    key: 'buildRevision',
    label: 'Build revision',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'order_build_revision',
    systemSortOrder: 'aL',
    nullable: true,
    // An internal comparison token. Nobody reads a hash off a screen.
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description:
      'Fingerprint of what this order currently asks production for. Compared against a ' +
      "build's own stamp to show that the order changed after the build was raised",
  },

  // Reverse relationship: creditMemos (from credit_memo.order). The
  // `credit_memo` side lands with entity migration 136; both halves are created
  // in that one pass, so `linkNewRelationships` resolves this immediately.
  //
  // A channel credit memo is INGESTED - the connector fans `refunds[]` out of
  // the order payload it already fetches, the same way `line_items[]` works
  // (plans/accounting/tasks/10-credit-memos.md §2.1). This is the relationship
  // that fan-out writes through. `cascade` stays, and the credit memo delete
  // guard vetoes it: deleting an order with an issued memo is refused naming
  // the memo (10 §2.6).
  creditMemos: {
    id: toFieldId('creditMemos'),
    key: 'creditMemos',
    label: 'Credit Memos',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_credit_memos',
    systemSortOrder: 'aM',
    showInPanel: false, // has_many inverse; surfaced from the credit memo side
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'credit_memo:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'Credit memos raised against this order - money returned, goods returned, or both',
  },

  // Reverse relationship: taxLines (from tax_line.order). The `tax_line` side
  // lands with entity migration 136 alongside `credit_memo`.
  //
  // Records rather than a JSON blob because the question this exists to answer
  // is tax by jurisdiction over a period, and an aggregation wants rows
  // (plans/money/tasks/48-shopify-tax-data.md §4.1). Per-LINE tax stays a
  // scalar on `line_item` - fanning that out too would multiply records to
  // serve nothing.
  taxLines: {
    id: toFieldId('taxLines'),
    key: 'taxLines',
    label: 'Tax Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_tax_lines',
    systemSortOrder: 'aN',
    showInPanel: false, // has_many inverse; surfaced from the tax-line side
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'tax_line:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description:
      'One row per taxing jurisdiction, as the provider computed it - what makes tax by ' +
      'jurisdiction answerable',
  },

  // Reverse relationship: shipments (from shipment.order). The `shipment` side
  // lands with entity migration 149
  // (plans/apps/shipstation/shared-shipment-entities-proposal.md §6).
  //
  // ⚠️ DISTINCT from `fulfillments` above. That JSON field is the ACCOUNTING
  // fulfillment record - what quantity was recognised and which GL posting it
  // produced. A shipment is the PHYSICAL dispatch, with per-box tracking.
  //
  // `unlink`, not `cascade`: a shipment is a record of a physical dispatch that
  // ShipStation minted and still owns, so deleting the auxx order record must
  // not delete the other system's shipment and its parcels. Contrast
  // `creditMemos` directly above, which cascades because a channel credit memo
  // is fanned out of the order payload and has no life without it.
  //
  // 🛑 This edge CANNOT be populated yet (proposal §4). `linkMode: 'reference'`
  // cannot cross connectors - `findItemByDef` filters `dataConnectorId` with
  // hard equality (`data-connectors/relationship-pass.ts`) - so a ShipStation
  // reference to a Shopify-created order resolves nothing, and unresolved edges
  // never expire: they go back on `stillPending` and retry every run.
  // Populating this needs a native `match` on a column Shopify already writes,
  // or the platform resolver in the ShipStation build plan §6.
  shipments: {
    id: toFieldId('shipments'),
    key: 'shipments',
    label: 'Shipments',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_shipments',
    systemSortOrder: 'aO',
    showInPanel: false, // has_many inverse; surfaced from the shipment side
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'shipment:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    },
    description:
      'Physical dispatches of this order - one per shipment, each carrying its own parcels ' +
      'and tracking numbers',
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
    description: 'Automatically set when the order is created',
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
    description: 'Automatically updated when the order is modified',
  },

  // Reverse relationship: returns (from return:order)
  returns: {
    id: toFieldId('returns'),
    key: 'returns',
    label: 'Returns',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'order_returns',
    showInPanel: false,
    systemSortOrder: 'aP',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'return:order' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'Returns against this order',
  },

  createdBy: CREATED_BY_FIELD,
}
