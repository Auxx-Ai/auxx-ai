// packages/lib/src/accounting/documents/lines/client.ts

// Client-safe: types, the per-kind config and pure helpers. No server imports and no
// 'use client' directive (server code imports this file too).
import { RATE_DECIMALS, roundMinor } from '@auxx/utils/currency'
import { z } from 'zod'
import {
  computeLineTotal,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemUnit,
  roundCents,
} from '../../sales/client'

/** The documents that own editable line rows. */
export const LINE_DOCUMENT_TYPES = [
  'quote',
  'order',
  'invoice',
  'work_order',
  'credit_memo',
  'purchase_order',
  'vendor_bill',
  'vendor_credit',
] as const

export type LineDocumentType = (typeof LINE_DOCUMENT_TYPES)[number]

/** The line entity each document's rows are stored as in L0. */
export type LineEntityType =
  | 'line_item'
  | 'credit_memo_line'
  | 'purchase_order_line'
  | 'vendor_bill_line'
  | 'vendor_credit_line'

/** A stored photo envelope on a sell-side line (`line_item_photos`). */
export interface LinePhoto {
  ref: string
  caption?: string
  internal?: boolean
}

/**
 * One line, for every kind. Money is integer minor units, rates at the field's precision.
 * A key the kind does not carry is `null`; a key it carries but nobody set is `null` too.
 */
export interface Line {
  id: string
  documentType: LineDocumentType
  documentId: string
  sortOrder: number | null
  name: string | null
  description: string | null
  category: string | null
  unit: LineItemUnit | null
  qty: number | null
  unitPrice: number | null
  discount: number | null
  taxable: boolean | null
  lineTotal: number | null
  netTotal: number | null
  taxTotal: number | null
  optional: boolean | null
  optionalSelected: boolean | null
  partId: string | null
  visitId: string | null
  sourceLineId: string | null
  fulfilledAt: string | null
  fulfilledQty: number | null
  shipmentCount: number | null
  /** Present only on kinds with photos; written by the photo popover, never through a patch. */
  photos?: LinePhoto[]
  sourceLineItemId: string | null
  disposition: string | null
  vendorPartId: string | null
  quantityReceived: number | null
  quantityBilled: number | null
  weight: number | null
  glAccountId: string | null
  landedBillId: string | null
  purchaseOrderLineId: string | null
  vendorCode: string | null
  returnsStock: boolean | null
}

/** Every value key of a {@link Line}. */
export type LineKey = Exclude<keyof Line, 'id' | 'documentType' | 'documentId'>

/** Every value key, in one fixed order. */
export const LINE_KEYS = [
  'sortOrder',
  'name',
  'description',
  'category',
  'unit',
  'qty',
  'unitPrice',
  'discount',
  'taxable',
  'lineTotal',
  'netTotal',
  'taxTotal',
  'optional',
  'optionalSelected',
  'partId',
  'visitId',
  'sourceLineId',
  'fulfilledAt',
  'fulfilledQty',
  'shipmentCount',
  'photos',
  'sourceLineItemId',
  'disposition',
  'vendorPartId',
  'quantityReceived',
  'quantityBilled',
  'weight',
  'glAccountId',
  'landedBillId',
  'purchaseOrderLineId',
  'vendorCode',
  'returnsStock',
] as const satisfies readonly LineKey[]

/**
 * Keys no patch or create may carry: the engine, the connector, the photo popover or
 * `reorderLines` writes them. `lineTotal` joins them on every kind whose amount is not stored.
 */
export const ENGINE_OWNED_LINE_KEYS = [
  'sortOrder',
  'netTotal',
  'sourceLineId',
  'fulfilledAt',
  'fulfilledQty',
  'shipmentCount',
  'photos',
  'quantityReceived',
  'quantityBilled',
] as const satisfies readonly LineKey[]

type EngineOwnedLineKey = (typeof ENGINE_OWNED_LINE_KEYS)[number]

/** The keys a patch can name on some kind. */
export type WritableLineKey = Exclude<LineKey, EngineOwnedLineKey>

/** A semantic update: absent keys are not written, `null` clears. */
export type LinePatch = Partial<Pick<Line, WritableLineKey>>

/** What one new line is created with; the module stamps parent and sort order. */
export type CreateLineInput = LinePatch

/** See the builder's `TotalsMode` history in plans/purchasing/03-line-builder-reuse.md. */
export type TotalsMode = 'computed' | 'stated' | 'stored' | 'none'

/** Where a line's amount lives: `derived` and `derived-editable` never store it, `stored` does. */
export type AmountMode = 'derived' | 'derived-editable' | 'stored'

/** What a document's line rows can do; see plans/purchasing/03-line-builder-reuse.md. */
export interface LineCapabilities {
  taxable: boolean
  optional: boolean
  category: boolean
  unit: boolean
  photos: boolean
  catalogPicker: boolean
  /** `purchase_order_line.part` is required, so a draft may not materialize without one. */
  draftRequiresPart: boolean
  partPicker: boolean
  paymentMirrors: boolean
  /** work_order only: rows split on `visitId`. */
  visitScoped: boolean
  /** invoice only: a work-order source line stamped with the invoice is not the invoice's line. */
  excludeWorkOrderSourceLines: boolean
}

/** The per-kind config the module and the builder share. Header attrs stay: the header is an entity. */
export interface LineKind {
  documentType: LineDocumentType
  /** L0 storage entity; kept for the photo popover, which still writes the line's FILE field. */
  lineEntityType: LineEntityType
  /** The header entity type, which is also the realtime room's def. */
  parentEntityType: LineDocumentType
  family: 'sales' | 'purchasing'
  /** The {@link Line} keys this kind carries. */
  fields: readonly LineKey[]
  primaryTextKey: 'name' | 'description'
  primaryColumnLabel: string
  totalsMode: TotalsMode
  /** `stored` only: whether the header amounts are typed, or written by the totals hook. */
  headerAmountsTyped: boolean
  amountMode: AmountMode
  /** Parent attribute scoping the match-key picker. */
  matchScopeAttr: string | null
  /** Parent attribute naming the supplier the price prefill resolves on. */
  vendorAttr: string | null
  billingPrefix: string
  /** Parent attributes the footer reads through `useSystemValues`, incl. the totals mirrors. */
  billingAttrs: string[]
  /** The line FILE field the photo popover writes directly. */
  photosAttr: string | null
  capabilities: LineCapabilities
}

const SELL_SIDE_CAPABILITIES: LineCapabilities = {
  taxable: true,
  optional: false,
  category: true,
  unit: true,
  photos: true,
  catalogPicker: true,
  partPicker: false,
  draftRequiresPart: false,
  paymentMirrors: false,
  visitScoped: false,
  excludeWorkOrderSourceLines: false,
}

const BUY_SIDE_CAPABILITIES: LineCapabilities = {
  taxable: false,
  optional: false,
  category: false,
  unit: false,
  photos: false,
  catalogPicker: false,
  partPicker: true,
  draftRequiresPart: false,
  paymentMirrors: false,
  visitScoped: false,
  excludeWorkOrderSourceLines: false,
}

const LINE_ITEM_KEYS = [
  'sortOrder',
  'name',
  'description',
  'category',
  'unit',
  'qty',
  'unitPrice',
  'discount',
  'taxable',
  'lineTotal',
  'netTotal',
  'taxTotal',
  'optional',
  'optionalSelected',
  'partId',
  'visitId',
  'sourceLineId',
  'fulfilledAt',
  'fulfilledQty',
  'shipmentCount',
  'photos',
] as const satisfies readonly LineKey[]

function billingAttrsFor(prefix: string): string[] {
  return [
    `${prefix}_discount_type`,
    `${prefix}_discount_value`,
    `${prefix}_tax_name`,
    `${prefix}_tax_rate`,
    `${prefix}_subtotal`,
    `${prefix}_tax_total`,
    `${prefix}_total`,
  ]
}

function sellSide(
  documentType: 'quote' | 'order' | 'invoice' | 'work_order',
  overrides: Partial<LineKind>
): LineKind {
  return {
    documentType,
    lineEntityType: 'line_item',
    parentEntityType: documentType,
    family: 'sales',
    fields: LINE_ITEM_KEYS,
    primaryTextKey: 'name',
    primaryColumnLabel: 'Description',
    totalsMode: 'computed',
    headerAmountsTyped: false,
    amountMode: 'derived',
    matchScopeAttr: null,
    vendorAttr: null,
    billingPrefix: documentType,
    billingAttrs: billingAttrsFor(documentType),
    photosAttr: 'line_item_photos',
    capabilities: SELL_SIDE_CAPABILITIES,
    ...overrides,
  }
}

/**
 * Per-document config, keyed on {@link LineDocumentType}. Lookups, never ternaries: a
 * two-way `documentType === 'invoice' ? … : 'quote'` once wrote quote totals onto orders.
 */
export const LINE_KINDS: Record<LineDocumentType, LineKind> = {
  quote: sellSide('quote', {
    capabilities: { ...SELL_SIDE_CAPABILITIES, optional: true },
  }),
  invoice: sellSide('invoice', {
    billingAttrs: [...billingAttrsFor('invoice'), 'invoice_amount_paid', 'invoice_balance'],
    capabilities: {
      ...SELL_SIDE_CAPABILITIES,
      paymentMirrors: true,
      excludeWorkOrderSourceLines: true,
    },
  }),
  order: sellSide('order', {
    billingAttrs: [...billingAttrsFor('order'), 'order_shipping_total'],
  }),
  work_order: sellSide('work_order', {
    totalsMode: 'none',
    billingAttrs: [],
    capabilities: { ...SELL_SIDE_CAPABILITIES, visitScoped: true },
  }),
  purchase_order: {
    documentType: 'purchase_order',
    lineEntityType: 'purchase_order_line',
    parentEntityType: 'purchase_order',
    family: 'purchasing',
    fields: [
      'sortOrder',
      'description',
      'qty',
      'unitPrice',
      'lineTotal',
      'partId',
      'vendorPartId',
      'weight',
      'quantityReceived',
      'quantityBilled',
    ],
    primaryTextKey: 'description',
    primaryColumnLabel: 'Part',
    totalsMode: 'stated',
    headerAmountsTyped: false,
    // The amount cell is an input that back-solves the rate; the total itself is engine-owned.
    amountMode: 'derived-editable',
    matchScopeAttr: null,
    vendorAttr: 'purchase_order_vendor',
    billingPrefix: 'purchase_order',
    billingAttrs: [
      'purchase_order_discount_value',
      'purchase_order_shipping_total',
      'purchase_order_tax_total',
      'purchase_order_subtotal',
      'purchase_order_total',
    ],
    photosAttr: null,
    capabilities: { ...BUY_SIDE_CAPABILITIES, draftRequiresPart: true },
  },
  vendor_bill: {
    documentType: 'vendor_bill',
    lineEntityType: 'vendor_bill_line',
    parentEntityType: 'vendor_bill',
    family: 'purchasing',
    fields: [
      'sortOrder',
      'description',
      'vendorCode',
      'qty',
      'unitPrice',
      'lineTotal',
      'partId',
      'purchaseOrderLineId',
      'landedBillId',
      'glAccountId',
    ],
    primaryTextKey: 'description',
    primaryColumnLabel: 'Part',
    // The bill's totals are transcribed from the vendor's paper; recomputing them hides the
    // arithmetic error the three-way match exists to surface.
    totalsMode: 'stored',
    headerAmountsTyped: true,
    amountMode: 'stored',
    matchScopeAttr: 'vendor_bill_purchase_order',
    vendorAttr: null,
    billingPrefix: 'vendor_bill',
    billingAttrs: [
      'vendor_bill_subtotal',
      'vendor_bill_shipping_total',
      'vendor_bill_tax_total',
      'vendor_bill_discount',
      'vendor_bill_total',
    ],
    photosAttr: null,
    capabilities: BUY_SIDE_CAPABILITIES,
  },
  credit_memo: {
    documentType: 'credit_memo',
    lineEntityType: 'credit_memo_line',
    parentEntityType: 'credit_memo',
    family: 'sales',
    fields: [
      'sortOrder',
      'name',
      'qty',
      'unitPrice',
      'lineTotal',
      'taxTotal',
      'sourceLineItemId',
      'disposition',
    ],
    primaryTextKey: 'name',
    primaryColumnLabel: 'Description',
    totalsMode: 'stored',
    headerAmountsTyped: false,
    amountMode: 'stored',
    matchScopeAttr: null,
    vendorAttr: null,
    billingPrefix: 'credit_memo',
    billingAttrs: ['credit_memo_subtotal', 'credit_memo_tax_total', 'credit_memo_total'],
    photosAttr: null,
    capabilities: {
      ...BUY_SIDE_CAPABILITIES,
      partPicker: false,
    },
  },
  vendor_credit: {
    documentType: 'vendor_credit',
    lineEntityType: 'vendor_credit_line',
    parentEntityType: 'vendor_credit',
    family: 'purchasing',
    fields: [
      'sortOrder',
      'description',
      'qty',
      'unitPrice',
      'lineTotal',
      'partId',
      'purchaseOrderLineId',
      'glAccountId',
      'returnsStock',
    ],
    primaryTextKey: 'description',
    primaryColumnLabel: 'Part',
    totalsMode: 'stored',
    headerAmountsTyped: false,
    amountMode: 'stored',
    matchScopeAttr: 'vendor_credit_purchase_order',
    vendorAttr: null,
    billingPrefix: 'vendor_credit',
    billingAttrs: ['vendor_credit_subtotal', 'vendor_credit_tax_total', 'vendor_credit_total'],
    photosAttr: null,
    capabilities: BUY_SIDE_CAPABILITIES,
  },
}

/** The config for one document type. */
export function lineKindFor(documentType: LineDocumentType): LineKind {
  return LINE_KINDS[documentType]
}

/** The keys a patch or create may carry on this kind. */
export function writableLineKeys(documentType: LineDocumentType): WritableLineKey[] {
  const kind = LINE_KINDS[documentType]
  const engine = new Set<LineKey>(ENGINE_OWNED_LINE_KEYS)
  if (kind.amountMode !== 'stored') engine.add('lineTotal')
  return kind.fields.filter((key): key is WritableLineKey => !engine.has(key))
}

/** Drop the keys this kind cannot write, e.g. the typed amount a `derived-editable` cell back-solved from. */
export function pickWritablePatch(patch: LinePatch, documentType: LineDocumentType): LinePatch {
  const out: Record<string, unknown> = {}
  for (const key of writableLineKeys(documentType)) {
    if (Object.hasOwn(patch, key)) out[key] = patch[key]
  }
  return out as LinePatch
}

const nullableText = z.string().nullable()
const nullableNumber = z.number().finite().nullable()
const nullableBoolean = z.boolean().nullable()
const nullableId = z.string().min(1).nullable()
const nullableUnit = z
  .enum(LINE_ITEM_UNIT_OPTIONS.map((option) => option.value) as [LineItemUnit, ...LineItemUnit[]])
  .nullable()

const WRITABLE_SHAPE = {
  name: nullableText,
  description: nullableText,
  category: nullableText,
  unit: nullableUnit,
  qty: nullableNumber,
  unitPrice: nullableNumber,
  discount: nullableNumber,
  taxable: nullableBoolean,
  lineTotal: nullableNumber,
  taxTotal: nullableNumber,
  optional: nullableBoolean,
  optionalSelected: nullableBoolean,
  partId: nullableId,
  visitId: nullableText,
  sourceLineItemId: nullableId,
  disposition: nullableText,
  vendorPartId: nullableId,
  weight: nullableNumber,
  glAccountId: nullableId,
  landedBillId: nullableId,
  purchaseOrderLineId: nullableId,
  vendorCode: nullableText,
  returnsStock: nullableBoolean,
} satisfies Record<WritableLineKey, z.ZodType>

/**
 * Every key some kind can write. Strict: an engine-owned key is refused, not dropped.
 * {@link linePatchSchemaFor} narrows it to one kind.
 */
export const linePatchSchema = z.strictObject(WRITABLE_SHAPE).partial()

/** {@link linePatchSchema} restricted to what `documentType` can write. */
export function linePatchSchemaFor(documentType: LineDocumentType) {
  const mask = Object.fromEntries(writableLineKeys(documentType).map((key) => [key, true]))
  return z
    .strictObject(WRITABLE_SHAPE)
    .partial()
    .pick(mask as Record<WritableLineKey, true>)
}

/** Create input takes the same keys a patch does. */
export const createLineInputSchema = linePatchSchema

const WRITABLE_KEYS = Object.keys(WRITABLE_SHAPE) as WritableLineKey[]

/** Only the writable values that changed between two snapshots of one line. */
export function diffLineValues(before: Line, after: Line): LinePatch {
  const patch: Record<string, unknown> = {}
  for (const key of WRITABLE_KEYS) {
    if (!Object.is(before[key], after[key])) patch[key] = after[key]
  }
  return patch as LinePatch
}

/**
 * Fill the sibling of whichever of rate / amount was just typed. `stored` fills only a
 * blank sibling (never corrects a transcription); `derived-editable` always back-solves the
 * rate at RATE_DECIMALS. A no-op on `derived`.
 */
export function crossFillAmount(patch: LinePatch, line: Line, kind: LineKind): LinePatch {
  if (kind.amountMode !== 'stored' && kind.amountMode !== 'derived-editable') return patch
  const qty = patch.qty ?? line.qty ?? 1

  if (Object.hasOwn(patch, 'lineTotal') && !Object.hasOwn(patch, 'unitPrice')) {
    const lineTotal = patch.lineTotal ?? null
    const fillable = kind.amountMode === 'derived-editable' || line.unitPrice === null
    // `qty > 0` is a division guard, not a policy.
    if (lineTotal !== null && fillable && qty > 0) {
      const unitPrice =
        kind.amountMode === 'derived-editable'
          ? roundMinor(lineTotal / qty, RATE_DECIMALS)
          : roundCents(lineTotal / qty)
      return { ...patch, unitPrice }
    }
    return patch
  }

  if (Object.hasOwn(patch, 'unitPrice') && !Object.hasOwn(patch, 'lineTotal')) {
    if (kind.amountMode === 'derived-editable') return patch
    const unitPrice = patch.unitPrice ?? null
    if (unitPrice !== null && line.lineTotal === null) {
      return { ...patch, lineTotal: computeLineTotal(qty, unitPrice) }
    }
  }
  return patch
}

/** Whether a stored amount disagrees with `qty × rate`; rendered, never fixed. `stored` only. */
export function hasAmountMismatch(line: Line, kind: LineKind): boolean {
  if (kind.amountMode !== 'stored') return false
  if (line.lineTotal === null || line.unitPrice === null) return false
  return computeLineTotal(line.qty ?? 1, line.unitPrice) !== line.lineTotal
}
