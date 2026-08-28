// packages/lib/src/resources/registry/resources/purchase-order-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import {
  LandedCostAllocationBasis,
  PurchaseOrderBillingStatus,
  PurchaseOrderReceiptStatus,
  PurchaseOrderStatus,
} from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Purchase Order resource — the buy-side head of the
 * purchase-to-pay chain (plans/purchasing/01-build-plan.md §4.1).
 *
 * A purchase order records **what was ordered from a supplier**: it is issued,
 * received against line by line, and then billed. It is the mirror of `order`
 * on the sell side, and like `order` it is a totalled money document with
 * `hasDetailPage: true` — a PO is iterated and worked, which is page-shaped
 * rather than drawer-shaped.
 *
 * The header carries `shippingTotal`, `taxTotal`, `discountValue`,
 * `allocationBasis` and `taxRecoverable` because together they are exactly
 * `allocateLandedCost`'s argument list. That is why receiving needs no separate
 * `goods_receipt` header: the one thing such a header would have uniquely
 * justified already lives here.
 *
 * Money is stored in **integer minor units** (`subtotal`, `shippingTotal`,
 * `taxTotal`, `discountValue`, `total`).
 */
export const PURCHASE_ORDER_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique purchase order identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'purchase_order_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // RecordSequence-issued — the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description:
      'Auto-generated purchase order number — RecordSequence scope `purchase_order`, prefix `PO`',
  },

  vendor: {
    id: toFieldId('vendor'),
    key: 'vendor',
    label: 'Vendor',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_vendor',
    systemSortOrder: 'a2',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'company:purchaseOrders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      // A supplier is a `company`, never a `contact` — the same target
      // `vendor_part.contact` settled on. A PO is placed with an organisation.
      relatedEntityType: 'company',
      relationshipType: 'belongs_to',
      inverseName: 'Purchase Orders',
      inverseSystemAttribute: 'company_purchase_orders',
    },
    description: 'Supplier this order was placed with — required, the selling party',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_contact',
    systemSortOrder: 'a2a',
    // Optional, unlike `quote_contact`: a quote cannot exist without the
    // customer it is addressed to, but a PO is drafted against a `company`
    // first and the person to send it to is settled later.
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'contact:purchaseOrders' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Purchase Orders',
      inverseSystemAttribute: 'contact_purchase_orders',
    },
    // The ADDRESSEE, and the reason this field exists at all: `vendor` targets a
    // `company`, and a company carries no email of its own — only
    // `company_primary_contact` — so without this there is nobody to send the
    // order to. Mirrors `quote_contact` / `invoice_contact` so the send path's
    // contact lookup extends by one map entry rather than growing a branch.
    //
    // Intended to DEFAULT from the vendor's `company_primary_contact` and stay
    // overwritable — the prefill is not written yet.
    description:
      'Person at the vendor this order is sent to — defaults from the vendor’s primary contact',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'purchase_order_status',
    systemSortOrder: 'a3',
    nullable: true,
    options: { options: PurchaseOrderStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    // The ACTION axis only — where a person (or the Send action) has moved the
    // order to. What arrived and what was billed are `receiptStatus` and
    // `billingStatus` below, because those two move independently of this one
    // and of each other.
    description:
      'Where the order sits between drafted and closed — issued means sent to the vendor',
    defaultValue: 'draft',
  },

  receiptStatus: {
    id: toFieldId('receiptStatus'),
    key: 'receiptStatus',
    label: 'Receipt Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'purchase_order_receipt_status',
    systemSortOrder: 'a3a',
    nullable: true,
    options: { options: PurchaseOrderReceiptStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // the line roll-up is the ONLY writer
      updatable: false,
      computed: true,
      configurable: false,
    },
    // Same shape and same reason as `purchase_order_line_quantity_received`: the
    // subledger is the truth, and a hand-set copy of a SUM diverges silently.
    description:
      'How much of the order has arrived — derived from the line quantityReceived roll-up, never typed',
  },

  billingStatus: {
    id: toFieldId('billingStatus'),
    key: 'billingStatus',
    label: 'Billing Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'purchase_order_billing_status',
    systemSortOrder: 'a3b',
    nullable: true,
    options: { options: PurchaseOrderBillingStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // the line roll-up is the ONLY writer
      updatable: false,
      computed: true,
      configurable: false,
    },
    // BILLED, not PAID: payment lives on the vendor bill and one order can carry
    // several, so a PO-level payment figure would summarise state it does not own.
    description:
      'How much of the order has been billed — derived from the line quantityBilled roll-up, never typed',
  },

  orderedAt: {
    id: toFieldId('orderedAt'),
    key: 'orderedAt',
    label: 'Ordered',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'purchase_order_ordered_at',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select date ordered',
    description: 'When the order was placed with the supplier',
  },

  expectedAt: {
    id: toFieldId('expectedAt'),
    key: 'expectedAt',
    label: 'Expected',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'purchase_order_expected_at',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select expected date',
    description: 'Promised delivery date — the expediting list sorts and filters on this',
  },

  terms: {
    id: toFieldId('terms'),
    key: 'terms',
    label: 'Terms',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'purchase_order_terms',
    systemSortOrder: 'a6',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Net 30',
    // Free text on purpose. Real supplier terms are prose ("2/10 net 30, FOB
    // origin"); a select would have to be extended by hand on every new supplier.
    description: 'Payment and delivery terms as agreed with the supplier',
  },

  currency: {
    id: toFieldId('currency'),
    key: 'currency',
    label: 'Currency',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'purchase_order_currency',
    systemSortOrder: 'a7',
    showInPanel: false,
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
  },

  reference: {
    id: toFieldId('reference'),
    key: 'reference',
    label: 'Reference',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'purchase_order_reference',
    systemSortOrder: 'a8',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: "Supplier's confirmation number",
    // Theirs, not ours: `number` is the document we issued, this is what came
    // back. Matching a packing slip needs both.
    description: "The supplier's own order or confirmation number",
  },

  shipTo: {
    id: toFieldId('shipTo'),
    key: 'shipTo',
    label: 'Ship To',
    type: BaseType.OBJECT,
    // ADDRESS_STRUCT, not the bare ADDRESS type — every system entity that has
    // an address uses ADDRESS_STRUCT. Not one registry field uses ADDRESS.
    fieldType: FieldType.ADDRESS_STRUCT,
    isSystem: true,
    systemAttribute: 'purchase_order_ship_to',
    systemSortOrder: 'a9',
    showInTable: false,
    nullable: true,
    options: { addressComponents: ['street', 'city', 'state', 'country'] },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Where the supplier ships this order — a drop-ship is not always our own dock',
  },

  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'purchase_order_subtotal',
    systemSortOrder: 'aA',
    showInPanel: false, // shown in the lines overview card
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

  shippingTotal: {
    id: toFieldId('shippingTotal'),
    key: 'shippingTotal',
    label: 'Shipping Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'purchase_order_shipping_total',
    systemSortOrder: 'aB',
    showInPanel: false, // shown in the lines overview card
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
    placeholder: 'Freight charged on this order',
    // Typed by hand from the freight invoice: this is an INPUT to
    // `allocateLandedCost`, not a derived figure.
    description:
      'Freight for the whole order, integer minor units — spread across lines on receipt',
  },

  taxTotal: {
    id: toFieldId('taxTotal'),
    key: 'taxTotal',
    label: 'Tax Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'purchase_order_tax_total',
    systemSortOrder: 'aC',
    showInPanel: false, // shown in the lines overview card
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
      'Tax for the whole order, integer minor units — capitalised into cost only when ' +
      '`taxRecoverable` is false',
  },

  discountValue: {
    id: toFieldId('discountValue'),
    key: 'discountValue',
    label: 'Discount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'purchase_order_discount_value',
    systemSortOrder: 'aD',
    showInPanel: false, // shown in the lines overview card
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
    // Flat amount only — a percent-vs-amount pair is a customer-facing quoting
    // nicety, and a supplier discount arrives on the invoice as a number.
    description: 'Order-level discount, integer minor units — a negative landed-cost adder',
  },

  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'purchase_order_total',
    systemSortOrder: 'aE',
    showInPanel: false, // shown in the lines overview card
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

  allocationBasis: {
    id: toFieldId('allocationBasis'),
    key: 'allocationBasis',
    label: 'Allocation Basis',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'purchase_order_allocation_basis',
    systemSortOrder: 'aF',
    showInTable: false,
    nullable: true,
    options: { options: LandedCostAllocationBasis.values },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select allocation basis',
    // A parameter, not a constant: value-weighting alone makes a $1 part absorb
    // its share of a $10,000 freight bill in proportion to nothing that shipped.
    description: 'How shipping, tax and discount are spread across the lines on receipt',
    defaultValue: 'value',
  },

  taxRecoverable: {
    id: toFieldId('taxRecoverable'),
    key: 'taxRecoverable',
    label: 'Tax Recoverable',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'purchase_order_tax_recoverable',
    systemSortOrder: 'aG',
    showInTable: false,
    nullable: false,
    defaultValue: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    // Reclaimable input tax is a receivable from the tax authority, not part of
    // what the inventory cost. Capitalising it overstates stock permanently.
    description: 'When true, tax is reclaimable and is NOT capitalised into inventory cost',
  },

  notes: {
    id: toFieldId('notes'),
    key: 'notes',
    label: 'Notes',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'purchase_order_notes',
    systemSortOrder: 'aH',
    showInTable: false, // long-form; shown in the panel, hidden from default table columns
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter internal notes',
    description: 'Internal notes — not shown to the supplier',
  },

  // Verbatim the `quote_pdf_asset` / `invoice_pdf_asset` shape — a bare
  // MediaAsset id in TEXT, not a relation. `ensure-pdf.ts` reads all three
  // through `cf[pointerAttr]` on the same code path, so a divergence here is a
  // bug in that path rather than a local choice.
  //
  // 🛑 It is what makes a re-send REUSE the last render. Without the field the
  // lookup returns undefined, `existingAssetId` is always undefined, and every
  // send re-renders AND mints a fresh MediaAsset — an asset leak that grows per
  // send, throws nothing, and produces a correct PDF every time. Nothing but
  // storage growth would ever show it.
  pdfAsset: {
    id: toFieldId('pdfAsset'),
    key: 'pdfAsset',
    label: 'PDF Asset',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'purchase_order_pdf_asset',
    systemSortOrder: 'aK',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
      hidden: true,
    },
    description:
      'MediaAsset id of the last-rendered purchase order PDF (money MQ2 build spec §C.1 recipe) ' +
      '— written only by ensureDocumentPdf via FieldValueService, never user-editable',
  },

  // Reverse relationship: lines (from purchase_order_line.purchaseOrder).
  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_lines',
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
      inverseResourceFieldId: 'purchase_order_line:purchaseOrder' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Lines on this purchase order',
  },

  // Reverse relationship: bills (from vendor_bill.purchaseOrder). The
  // `vendor_bill` side lands with phase 4; until it does, `linkNewRelationships`
  // leaves this unlinked and links it when the counterpart appears.
  bills: {
    id: toFieldId('bills'),
    key: 'bills',
    label: 'Bills',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'purchase_order_bills',
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
      inverseResourceFieldId: 'vendor_bill:purchaseOrder' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Supplier bills raised against this order — one order can be billed several times',
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
    description: 'Automatically set when the purchase order is created',
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
    description: 'Automatically updated when the purchase order is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
