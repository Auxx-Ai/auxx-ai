// apps/web/src/components/money/ui/line-builder/line-values.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import type { LineItemUnit } from '@auxx/lib/money/client'
import type { RecordId } from '@auxx/lib/resources/client'

/**
 * The documents that own editable line rows.
 *
 * Four of them hang off `line_item` (`quote`, `invoice`, `order`, `work_order`);
 * `purchase_order` and `vendor_bill` hang off their own line entities. That is
 * the whole reason {@link LineSchema} exists — see plans/purchasing/03-line-builder-reuse.md.
 */
export type DocumentType =
  | 'quote'
  | 'work_order'
  | 'invoice'
  | 'order'
  | 'purchase_order'
  | 'vendor_bill'

/**
 * How a document's totals relate to its lines.
 *
 * `computed` is the sell-side shape: a subtotal from the lines, then a discount
 * (type + value) and a tax RATE applied to it.
 *
 * `stated` is the purchase order. Its subtotal comes from the lines the same way,
 * but the rest of the document carries **amounts, not rates** — `discountValue`,
 * `shippingTotal` and `taxTotal` are keyed or produced by the freight allocation,
 * so `total = subtotal − discount + shipping + tax`. ⚠️ A PO has no
 * `_discount_type`, `_tax_name` or `_tax_rate` field at all, so rendering the
 * sell-side discount/tax controls over it writes to attributes that do not exist
 * — and computing `total` without shipping and tax disagrees with what the server
 * persists.
 *
 * 🛑 `stored` is not a cosmetic variant of `computed`. A vendor bill's totals are
 * **transcribed from the vendor's paper**, and recomputing them from the lines
 * would silently correct the vendor's own arithmetic — which is the exact
 * discrepancy the three-way match exists to surface
 * (plans/purchasing/01-build-plan.md §5.4b). A `stored` footer displays the
 * mirrors and computes nothing.
 */
export type TotalsMode = 'computed' | 'stated' | 'stored' | 'none'

/**
 * What a document's line rows can actually do.
 *
 * ⚠️ These replaced nine `documentType === '…'` equality branches. Each flag says
 * what the site *meant*, which the equality never did: `isQuote` was standing in
 * for "supports optional lines" in three files and for "has the optional-toggle
 * hotkey" in a fourth. A new document type that forgets a flag renders a cell
 * that writes to a field it does not have.
 */
export interface LineCapabilities {
  /** Per-line taxable toggle. Sell-side only. */
  taxable: boolean
  /** Optional / optional-selected pair — the quote's "good, better, best" rows. */
  optional: boolean
  /** Category badge dropdown, sourced from the field definition's options. */
  category: boolean
  /** Unit-of-measure select beside the quantity. */
  unit: boolean
  /** Per-line photo popover (plans 37b §4 / 40). */
  photos: boolean
  /** `/`-on-empty-cell catalog picker and catalog-group explode. */
  catalogPicker: boolean
  /**
   * Buy-side part picker in the row's leading cell, in place of the free-text
   * name. Mutually exclusive with {@link catalogPicker}: a sell-side line picks a
   * `catalog_item`, a purchasing line picks a `part`.
   */
  partPicker: boolean
  /** Invoice-only ledger mirrors (amount paid / balance) rendered under the totals. */
  paymentMirrors: boolean
  /** work_order only: rows split on `line_item_visitId` (dispatch lock). */
  visitScoped: boolean
  /** invoice only: exclude work-order source lines stamped with the gather pointer. */
  excludeWorkOrderSourceLines: boolean
  /**
   * `unstamp` routes deletion through `money.deleteInvoiceLine` (which unstamps the
   * gathered source line and recomputes server-side, money MI1 §G.3); `delete`
   * is the plain `record.delete` + explicit recompute pair.
   */
  deleteMode: 'delete' | 'unstamp'
}

/** Persisted and draft values edited by one line-builder row. */
export interface LineValues {
  name: string
  description: string | null
  category: string | null
  taxable: boolean
  qty: number
  unit: LineItemUnit | null
  unitPriceCents: number | null
  optional: boolean
  optionalSelected: boolean
  catalogItemRecordId: RecordId | null
  /**
   * Buy-side only: the part this line orders.
   *
   * 🛑 `purchase_order_line.part` is `required: true` and leg 2 of the natural key
   * `(purchaseOrder, part)` — a PO line has no identity without it, which is what
   * stops a re-sent order doubling its lines. So a buy-side draft row can only
   * materialize once this is set; see `capabilities.partPicker`.
   */
  partRecordId: RecordId | null
}

/**
 * Which system attribute backs each {@link LineValues} key on this document's line
 * entity. **`null` means the concept does not exist there** — not that it is
 * hidden. A `purchase_order_line` has no `taxable` field at all, so writing one
 * would create a field value against a field id that does not resolve.
 */
export type LineAttrMap = Record<keyof LineValues, string | null>

/**
 * Everything the line builder needs to know about one document's lines.
 *
 * ⚠️ Read the warning on {@link LINE_SCHEMAS}: every member here is a LOOKUP, and
 * that is deliberate.
 */
export interface LineSchema {
  /** The line entity's apiSlug — what the builder lists, creates and reorders against. */
  slug: string
  /** The line entity's `entityType`, for the reorder mutation's record ids. */
  lineEntityType: string
  /** Relation systemAttribute stamping a line to its parent (`line_item_quote`). */
  relKey: string
  /** The same relation in field-id notation, for list filters (`line_item:quote`). */
  relFieldId: string
  /** The line's own sort-order attribute. */
  sortAttr: string
  /** Which text column leads the row. A PO line has no `name`, so it leads with description. */
  primaryTextKey: 'name' | 'description'
  totalsMode: TotalsMode
  /** systemAttribute prefix for the parent's own billing mirrors (`quote_discount_type`). */
  billingPrefix: string
  /** Parent attributes fetched once by the builder and read by the footer. */
  billingAttrs: string[]
  attrs: LineAttrMap
  /** Photos ride outside `LineValues` — the popover reads/writes the field directly. */
  photosAttr: string | null
  capabilities: LineCapabilities
}

const NO_LINE_ATTRS: LineAttrMap = {
  name: null,
  description: null,
  category: null,
  taxable: null,
  qty: null,
  unit: null,
  unitPriceCents: null,
  optional: null,
  optionalSelected: null,
  catalogItemRecordId: null,
  partRecordId: null,
}

/** Every sell-side line is a `line_item`, so the four money documents share one map. */
const LINE_ITEM_ATTRS: LineAttrMap = {
  name: 'line_item_name',
  description: 'line_item_description',
  category: 'line_item_category',
  taxable: 'line_item_taxable',
  qty: 'line_item_qty',
  unit: 'line_item_unit',
  unitPriceCents: 'line_item_unit_price',
  optional: 'line_item_optional',
  optionalSelected: 'line_item_optional_selected',
  catalogItemRecordId: 'line_item_catalog_item',
  // `line_item.part` exists (it is stamped from the catalog item, #1917) but the
  // builder never edits it directly — the catalog pick is the only writer.
  partRecordId: null,
}

const SELL_SIDE_CAPABILITIES: LineCapabilities = {
  taxable: true,
  optional: false,
  category: true,
  unit: true,
  photos: true,
  catalogPicker: true,
  partPicker: false,
  paymentMirrors: false,
  visitScoped: false,
  excludeWorkOrderSourceLines: false,
  deleteMode: 'delete',
}

/** A purchasing line: description, quantity, buy price. None of the sell-side semantics. */
const BUY_SIDE_CAPABILITIES: LineCapabilities = {
  taxable: false,
  optional: false,
  category: false,
  unit: false,
  photos: false,
  // 🛑 Off, and it must stay off until a picker exists. `line_item` picks a
  // `catalog_item` (a SELL-side SKU); a purchasing line picks a `part` /
  // `vendor_part`. `useLineHotkeys` gates the `/` shortcut on this same flag, so
  // turning it on without a picker opens an empty catalog over the row.
  catalogPicker: false,
  partPicker: true,
  paymentMirrors: false,
  visitScoped: false,
  excludeWorkOrderSourceLines: false,
  deleteMode: 'delete',
}

function billingAttrsFor(prefix: string): string[] {
  return [
    `${prefix}_discount_type`,
    `${prefix}_discount_value`,
    `${prefix}_tax_name`,
    `${prefix}_tax_rate`,
  ]
}

/**
 * Per-document schema, keyed on {@link DocumentType}
 * (plans/products/08-order-build.md §5.6, generalized by
 * plans/purchasing/03-line-builder-reuse.md).
 *
 * ⚠️ These are LOOKUPS, not ternaries, and that is the whole point. `billingPrefix`
 * used to be `documentType === 'invoice' ? 'invoice' : 'quote'` — a two-way
 * expression that silently mapped `work_order`, and would have mapped `order`, to
 * the QUOTE prefix. A document reading and writing another document's
 * `quote_tax_rate` is exactly what that shape produces, so a new document type
 * must never be added to a boolean-shaped expression. `totals-hooks.ts` uses the
 * same shape server-side.
 *
 * Defined here, in the leaf of the line-builder module graph, because the builder,
 * the rows and the totals footer all need them — three hand-copied copies is how
 * the read prefix and the write prefix drift apart.
 */
export const LINE_SCHEMAS: Record<DocumentType, LineSchema> = {
  quote: {
    slug: 'line-items',
    lineEntityType: 'line_item',
    relKey: 'line_item_quote',
    relFieldId: 'line_item:quote',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    totalsMode: 'computed',
    billingPrefix: 'quote',
    billingAttrs: billingAttrsFor('quote'),
    attrs: LINE_ITEM_ATTRS,
    photosAttr: 'line_item_photos',
    capabilities: { ...SELL_SIDE_CAPABILITIES, optional: true },
  },
  invoice: {
    slug: 'line-items',
    lineEntityType: 'line_item',
    relKey: 'line_item_invoice',
    relFieldId: 'line_item:invoice',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    totalsMode: 'computed',
    billingPrefix: 'invoice',
    billingAttrs: [
      ...billingAttrsFor('invoice'),
      // Invoice-only: the ledger-sync mirrors (§E.4) — read-only here.
      'invoice_amount_paid',
      'invoice_balance',
    ],
    attrs: LINE_ITEM_ATTRS,
    photosAttr: 'line_item_photos',
    capabilities: {
      ...SELL_SIDE_CAPABILITIES,
      paymentMirrors: true,
      excludeWorkOrderSourceLines: true,
      deleteMode: 'unstamp',
    },
  },
  order: {
    slug: 'line-items',
    lineEntityType: 'line_item',
    relKey: 'line_item_order',
    relFieldId: 'line_item:order',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    totalsMode: 'computed',
    billingPrefix: 'order',
    billingAttrs: billingAttrsFor('order'),
    attrs: LINE_ITEM_ATTRS,
    photosAttr: 'line_item_photos',
    capabilities: SELL_SIDE_CAPABILITIES,
  },
  work_order: {
    slug: 'line-items',
    lineEntityType: 'line_item',
    relKey: 'line_item_work_order',
    relFieldId: 'line_item:workOrder',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    // The M2 job view stores no totals at all, so `billingPrefix` is never read —
    // every use is gated on `totalsMode`. It is still a real prefix rather than an
    // empty string so a missed gate fails loudly instead of building `_tax_rate`.
    totalsMode: 'none',
    billingPrefix: 'work_order',
    billingAttrs: [],
    attrs: LINE_ITEM_ATTRS,
    photosAttr: 'line_item_photos',
    capabilities: { ...SELL_SIDE_CAPABILITIES, visitScoped: true },
  },
  purchase_order: {
    slug: 'purchase-order-lines',
    lineEntityType: 'purchase_order_line',
    relKey: 'purchase_order_line_purchase_order',
    relFieldId: 'purchase_order_line:purchaseOrder',
    sortAttr: 'purchase_order_line_sort_order',
    primaryTextKey: 'description',
    // The PO IS our document and its subtotal is ours to compute
    // (plans/purchasing/01-build-plan.md §4.1 — `subtotal`/`total` are
    // `creatable: false`) — but shipping and tax are stated amounts, not rates.
    // Contrast `vendor_bill` below, whose totals are transcribed entirely.
    totalsMode: 'stated',
    billingPrefix: 'purchase_order',
    // ⚠️ Verified against PURCHASE_ORDER_FIELDS, not derived from the prefix.
    // `billingAttrsFor` would have asked for `_discount_type`, `_tax_name` and
    // `_tax_rate`, none of which the PO has. The cross-check that catches this
    // class of error lives in `packages/lib` beside the registry — a test in this
    // package can only ever re-read this table.
    billingAttrs: [
      'purchase_order_discount_value',
      'purchase_order_shipping_total',
      'purchase_order_tax_total',
    ],
    attrs: {
      ...NO_LINE_ATTRS,
      description: 'purchase_order_line_description',
      qty: 'purchase_order_line_quantity_ordered',
      unitPriceCents: 'purchase_order_line_expected_unit_price',
      partRecordId: 'purchase_order_line_part',
    },
    photosAttr: null,
    capabilities: BUY_SIDE_CAPABILITIES,
  },
  vendor_bill: {
    slug: 'vendor-bill-lines',
    lineEntityType: 'vendor_bill_line',
    relKey: 'vendor_bill_line_vendor_bill',
    relFieldId: 'vendor_bill_line:vendorBill',
    sortAttr: 'vendor_bill_line_sort_order',
    primaryTextKey: 'description',
    // 🛑 See TotalsMode. The bill is THEIRS; its totals are transcribed.
    totalsMode: 'stored',
    billingPrefix: 'vendor_bill',
    billingAttrs: ['vendor_bill_subtotal', 'vendor_bill_tax_total', 'vendor_bill_total'],
    attrs: {
      ...NO_LINE_ATTRS,
      description: 'vendor_bill_line_description',
      qty: 'vendor_bill_line_quantity_billed',
      unitPriceCents: 'vendor_bill_line_unit_price',
      partRecordId: 'vendor_bill_line_part',
    },
    photosAttr: null,
    capabilities: BUY_SIDE_CAPABILITIES,
  },
}

/** The schema for one document type. */
export function lineSchemaFor(documentType: DocumentType): LineSchema {
  return LINE_SCHEMAS[documentType]
}

/**
 * Every line attribute this document actually has, for the builder's one prefetch
 * of the record-id × field matrix.
 *
 * Derived from the schema rather than listed, which is what retires the old
 * `documentType === 'quote' ? QUOTE_LINE_SYSTEM_ATTRIBUTES : BASE_…` branch: a
 * document that has no `optional` field simply contributes no `optional` key.
 */
export function lineAttributesFor(schema: LineSchema): string[] {
  const attrs = Object.values(schema.attrs).filter((a): a is string => a !== null)
  // Photos are not part of `LineValues`/`linePatchToFieldValues` — the popover
  // (line-photo-popover.tsx) reads and writes the field directly via
  // `useFieldFileUpload`. Riding along in the same prefetch batch just gives the
  // trigger its count for free (plans 37b §4 / 40).
  return schema.photosAttr ? [...attrs, schema.photosAttr] : attrs
}

/** Field-value mutation input used by the shared save hook. */
export interface LineFieldValueUpdate {
  fieldId: string
  value: unknown
  fieldType: FieldTypeValue
}

/** Defaults shared by persisted rows and phantom drafts. */
export const DEFAULT_LINE_VALUES: LineValues = {
  name: '',
  description: null,
  category: null,
  taxable: true,
  qty: 1,
  unit: 'each',
  unitPriceCents: null,
  optional: false,
  optionalSelected: true,
  catalogItemRecordId: null,
  partRecordId: null,
}

/** Semantic update emitted by a row; absent keys are not written. */
export type LinePatch = Partial<LineValues>

const LINE_FIELD_TYPES: Record<keyof LineValues, FieldTypeValue> = {
  name: FieldType.TEXT,
  description: FieldType.TEXT,
  category: FieldType.SINGLE_SELECT,
  taxable: FieldType.CHECKBOX,
  qty: FieldType.NUMBER,
  unit: FieldType.SINGLE_SELECT,
  unitPriceCents: FieldType.CURRENCY,
  optional: FieldType.CHECKBOX,
  optionalSelected: FieldType.CHECKBOX,
  catalogItemRecordId: FieldType.RELATIONSHIP,
  partRecordId: FieldType.RELATIONSHIP,
}

const LINE_VALUE_KEYS = Object.keys(LINE_FIELD_TYPES) as Array<keyof LineValues>

/**
 * Convert a semantic patch into field-value mutation inputs for one document's lines.
 *
 * 🛑 Keys the schema maps to `null` are **dropped**, not written as null. A
 * `purchase_order_line` has no `taxable` field, and a patch carrying one — from a
 * shared default, a stale draft, or a copied row — would otherwise resolve to a
 * field id that does not exist on that entity.
 */
export function linePatchToFieldValues(
  patch: LinePatch,
  schema: LineSchema
): LineFieldValueUpdate[] {
  const updates: LineFieldValueUpdate[] = []
  for (const key of LINE_VALUE_KEYS) {
    if (!Object.hasOwn(patch, key)) continue
    const fieldId = schema.attrs[key]
    if (!fieldId) continue
    updates.push({ fieldId, value: patch[key], fieldType: LINE_FIELD_TYPES[key] })
  }
  return updates
}

/** Return only values that changed between two line snapshots. */
export function diffLineValues(before: LineValues, after: LineValues): LinePatch {
  const patch: LinePatch = {}
  for (const key of LINE_VALUE_KEYS) {
    if (!Object.is(before[key], after[key])) {
      ;(patch as Record<keyof LineValues, unknown>)[key] = after[key]
    }
  }
  return patch
}

/**
 * Normalize one passive `useSystemValues` result into the row's value shape.
 *
 * An attribute the schema maps to `null` falls back to its default rather than
 * reading `undefined` — so a purchasing line is taxable-by-default and
 * never-optional without those fields existing, which is what keeps
 * `computeDocumentTotals` (which takes all four) correct for a document that
 * carries none of them.
 */
export function lineValuesFromSystemValues(
  values: Record<string, unknown>,
  schema: LineSchema
): LineValues {
  const read = <T>(key: keyof LineValues): T | undefined => {
    const attr = schema.attrs[key]
    return attr ? (values[attr] as T | undefined) : undefined
  }
  const { optional: supportsOptional } = schema.capabilities
  return {
    name: read<string | null>('name') ?? '',
    description: read<string | null>('description') ?? null,
    category: read<string | null>('category') ?? null,
    taxable: read<boolean>('taxable') !== false,
    qty: read<number | null>('qty') ?? 1,
    unit: read<LineItemUnit | null>('unit') ?? null,
    unitPriceCents: read<number | null>('unitPriceCents') ?? null,
    optional: supportsOptional && read<boolean>('optional') === true,
    optionalSelected: !supportsOptional || read<boolean>('optionalSelected') !== false,
    catalogItemRecordId: null,
    partRecordId: read<RecordId | null>('partRecordId') ?? null,
  }
}
