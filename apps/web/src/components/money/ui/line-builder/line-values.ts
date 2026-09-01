// apps/web/src/components/money/ui/line-builder/line-values.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { computeLineTotal, type LineItemUnit, roundCents } from '@auxx/lib/money/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { RATE_DECIMALS, roundMinor } from '@auxx/utils/currency'

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
 * Where a LINE's amount lives — a different question from {@link TotalsMode},
 * which is about the document FOOTER. A document can have one without the other.
 *
 * `derived` — `…_line_total` is `creatable: false` on that line entity and the
 * server totals hook (`packages/lib/src/money/totals-hooks.ts`) is its only
 * writer, so the cell renders `qty × unitPrice` and is read-only.
 *
 * 🛑 It USED to be that typing there could only back-solve the rate at whole
 * cents: qty 3 against a typed $100.00 gave 3333¢, which the hook then
 * re-multiplied to $99.99 and pushed back over realtime - a drift of up to
 * `qty × ½¢` that made back-solving `expected_unit_price` (the three-way
 * match's price arm) hold the vendor to a number nobody agreed. **That
 * objection was a two-decimal objection.** At `RATE_DECIMALS` (five places)
 * $100.00 / 3 divides to $33.33333, which re-multiplies to $99.99999 and
 * rounds to $100.00 exactly - plans/money/tasks/31-sub-cent-rates.md §0.6.
 * `derived-editable` (below) is what that unlocks on a purchase order; plain
 * `derived` (quote/invoice/order/work_order) still has nothing to back-solve
 * INTO - those documents have no rate the buyer froze, so the cell stays
 * read-only.
 *
 * `derived-editable` - purchase order only (plans/money/tasks/31-sub-cent-rates.md
 * §2.6). The amount cell is an INPUT, but there is still no writable
 * `…_line_total` behind it: `purchase_order_line_line_total` is
 * `creatable: false, updatable: false` same as `derived`, so a typed amount is
 * never sent to the server (see `linePatchToFieldValues`, which drops any key
 * the schema maps to `null`). Typing there with a BLANK rate instead derives
 * `expected_unit_price = roundMinor(typed / qty, RATE_DECIMALS)` - the rate the
 * PO order freezes - and the cell then renders the ENGINE's `computeLineTotal`,
 * not the typed number. When the two disagree the row shows the same mismatch
 * marker `stored` does, because on a per-thousand quote they should already
 * agree by construction and a disagreement is worth a look.
 *
 * `stored` — the amount is a writable transcribed field with no hook behind it.
 * All three of qty / rate / amount are inputs, and {@link crossFillAmount} fills
 * only a BLANK sibling: it never corrects one the user already entered.
 */
export type AmountMode = 'derived' | 'derived-editable' | 'stored'

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
   * 🛑 Whether a draft row may only MATERIALIZE once its part is picked — split
   * off {@link partPicker}, which it used to ride on, because the two buy-side
   * documents disagree about it.
   *
   * `purchase_order_line.part` is `required: true` and leg 2 of the natural key
   * `(purchaseOrder, part)`, so a create without it is rejected by the server and
   * `createDraft` must accumulate instead. `vendor_bill_line.part` is NULLABLE and
   * stamped from the PO line — a bill line with no part at all is legal (freight, a
   * one-off, a line the vendor invented). Sharing one flag meant such a line was
   * typed and then silently never materialized: nothing threw, nothing logged.
   *
   * The registry halves of this pairing are pinned in
   * `packages/lib/src/resources/registry/line-builder-contract.test.ts`.
   */
  draftRequiresPart: boolean
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
  /**
   * The line's extended amount, in integer minor units.
   *
   * 🛑 Mapped to an attribute ONLY where the field is writable — see
   * {@link AmountMode}. On the five `derived` documents this is `null` and the
   * cell computes `qty × unitPrice` instead, which is what keeps the builder from
   * writing a field whose only writer is the server totals hook.
   */
  lineTotal: number | null
  /**
   * Buy-side only: the purchase order line this line is billed against — THE
   * THREE-WAY MATCH KEY. Nullable, because a bill line with no PO line behind it
   * is legal and simply cannot be matched.
   */
  purchaseOrderLineRecordId: RecordId | null
  /** Buy-side only: the account CODE this line posts to ('2160', '5090'). */
  glAccount: string | null
  /**
   * Purchase order only: the supplier's catalogue entry this line was priced
   * from — PROVENANCE, never a live price read.
   *
   * 🛑 Stamped once, when the part is picked, alongside the price it prefilled
   * (`resolvePartPrefill` in line-builder.tsx). `vendor_part_unit_price` is
   * `updatable: true` and `bom-cost-triggers.ts` recalculates part costs whenever
   * it moves, while {@link unitPriceCents} on a purchase order is the price the
   * order FROZE — the price arm of the three-way match. Re-deriving the line's
   * price through this link would make the agreed price stop being agreed. It
   * says where the number came from; it never says what the number is.
   * (plans/purchasing/05-receiving-cost-and-corrections.md §5.2.)
   */
  vendorPartRecordId: RecordId | null
  /**
   * Purchase order only: the line's total shipped weight — the `weight`
   * allocation basis's only input.
   *
   * ⚠️ Document-level in the UI even though it is stored per line; see
   * `LineSchema.attrs.weight` and `LineRowMenu` for why a per-row optional weight
   * is a broken allocation rather than a partly-configured one.
   */
  weight: number | null
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
  /**
   * Header for the leading column. A lookup rather than a derivation: the sell-side
   * cell leads with `name` and is headed "Description", so the label cannot be read
   * off {@link primaryTextKey}, and a buy-side row's leading control is a PART
   * picker — heading it "Description" names the wrong one of the two things stacked
   * in that cell.
   */
  primaryColumnLabel: string
  totalsMode: TotalsMode
  /** Whether the line's amount is computed from qty x rate or transcribed. */
  amountMode: AmountMode
  /**
   * Parent attribute scoping the row's match-key picker — the bill's own
   * `purchase_order`, which is the only order whose lines may be offered. `null`
   * on every document without a match key.
   *
   * ⚠️ Deliberately NOT folded into {@link billingAttrs}. That member is the
   * parent's billing mirrors, read by the footer; a relation living in it reads as
   * a mistake, and the footer would have to learn to skip it.
   */
  matchScopeAttr: string | null
  /**
   * Parent attribute naming the SUPPLIER this document is placed with — the one
   * input, besides the part, that the vendor-part price prefill needs
   * (plans/purchasing/05-receiving-cost-and-corrections.md §5.2).
   *
   * `null` on every document that does not prefill. Read off the parent once per
   * builder for the same reason {@link matchScopeAttr} is: the answer is the same
   * for every row, and a per-row read would be one fetch per line to learn it.
   *
   * ⚠️ Set on `purchase_order` and NOT on `vendor_bill`, which also has a vendor.
   * A bill transcribes prices the supplier already charged; prefilling one would
   * overwrite the vendor's own paper with our catalogue, which is the exact
   * disagreement the three-way match exists to surface.
   */
  vendorAttr: string | null
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
  lineTotal: null,
  purchaseOrderLineRecordId: null,
  glAccount: null,
  vendorPartRecordId: null,
  weight: null,
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
  // 🛑 `line_item_line_total` EXISTS and is deliberately unmapped: it is
  // `creatable: false, updatable: false` with the totals engine as its only
  // writer. Mapping it would let a patch name a field the server owns.
  lineTotal: null,
  purchaseOrderLineRecordId: null,
  glAccount: null,
  // Both are purchasing vocabulary. A sell-side line has no supplier and no
  // freight basis, so neither field exists on `line_item` to write to.
  vendorPartRecordId: null,
  weight: null,
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
  // Overridden to `true` by `purchase_order`, whose part is required. A bill's is
  // not — see the member's own doc for why sharing one flag was a silent defect.
  draftRequiresPart: false,
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
    amountMode: 'derived',
    matchScopeAttr: null,
    vendorAttr: null,
    relKey: 'line_item_quote',
    relFieldId: 'line_item:quote',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    primaryColumnLabel: 'Description',
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
    amountMode: 'derived',
    matchScopeAttr: null,
    vendorAttr: null,
    relKey: 'line_item_invoice',
    relFieldId: 'line_item:invoice',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    primaryColumnLabel: 'Description',
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
    amountMode: 'derived',
    matchScopeAttr: null,
    vendorAttr: null,
    relKey: 'line_item_order',
    relFieldId: 'line_item:order',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    primaryColumnLabel: 'Description',
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
    amountMode: 'derived',
    matchScopeAttr: null,
    vendorAttr: null,
    relKey: 'line_item_work_order',
    relFieldId: 'line_item:workOrder',
    sortAttr: 'line_item_sort_order',
    primaryTextKey: 'name',
    primaryColumnLabel: 'Description',
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
    // 🛑 `derived-editable`, not `derived`: the total cell is still engine-owned
    // (`purchase_order_line_line_total` is `creatable: false, updatable: false`),
    // but it is an INPUT - typing an amount with a blank rate derives
    // `expected_unit_price` at RATE_DECIMALS. See AmountMode's own doc.
    amountMode: 'derived-editable',
    matchScopeAttr: null,
    // The supplier the order is placed with, and the second half of the
    // `(part, supplier)` natural key the price prefill resolves on (§5.2).
    vendorAttr: 'purchase_order_vendor',
    relKey: 'purchase_order_line_purchase_order',
    relFieldId: 'purchase_order_line:purchaseOrder',
    sortAttr: 'purchase_order_line_sort_order',
    primaryTextKey: 'description',
    primaryColumnLabel: 'Part',
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
      // 🛑 Both fields were declared and had NO writer at all until
      // plans/purchasing/05-receiving-cost-and-corrections.md §5.2/§5.3 — read by
      // `use-purchase-order-lines.ts`, set by nothing. Mapping them here is what
      // gives them one: `vendorPart` is stamped by the price prefill on part
      // pick, `weight` by the row menu's weight control.
      vendorPartRecordId: 'purchase_order_line_vendor_part',
      weight: 'purchase_order_line_weight',
    },
    photosAttr: null,
    // `purchase_order_line.part` is `required: true` — a create without it is
    // rejected, so a draft may not materialize until one is picked.
    capabilities: { ...BUY_SIDE_CAPABILITIES, draftRequiresPart: true },
  },
  vendor_bill: {
    slug: 'vendor-bill-lines',
    lineEntityType: 'vendor_bill_line',
    // 🛑 The one `stored` document. Its `line_total` is TRANSCRIBED from the
    // vendor's paper and carries no hook, so all three of qty / rate / amount are
    // inputs — and where `qty × rate` disagrees with the amount, the row SAYS so
    // rather than reconciling it. That disagreement is the vendor's own
    // arithmetic, which is exactly what the three-way match exists to surface
    // (plans/purchasing/01-build-plan.md §5.4b).
    amountMode: 'stored',
    matchScopeAttr: 'vendor_bill_purchase_order',
    // A bill's vendor is transcribed, never prefilled — see `vendorAttr`.
    vendorAttr: null,
    relKey: 'vendor_bill_line_vendor_bill',
    relFieldId: 'vendor_bill_line:vendorBill',
    sortAttr: 'vendor_bill_line_sort_order',
    primaryTextKey: 'description',
    primaryColumnLabel: 'Part',
    // 🛑 See TotalsMode. The bill is THEIRS; its totals are transcribed.
    totalsMode: 'stored',
    billingPrefix: 'vendor_bill',
    billingAttrs: [
      'vendor_bill_subtotal',
      'vendor_bill_shipping_total',
      'vendor_bill_tax_total',
      'vendor_bill_total',
    ],
    attrs: {
      ...NO_LINE_ATTRS,
      description: 'vendor_bill_line_description',
      qty: 'vendor_bill_line_quantity_billed',
      unitPriceCents: 'vendor_bill_line_unit_price',
      partRecordId: 'vendor_bill_line_part',
      lineTotal: 'vendor_bill_line_line_total',
      purchaseOrderLineRecordId: 'vendor_bill_line_purchase_order_line',
      glAccount: 'vendor_bill_line_gl_account',
    },
    photosAttr: null,
    capabilities: BUY_SIDE_CAPABILITIES,
  },
}

/** The schema for one document type. */
/**
 * The baseline filter selecting one document's lines — the SINGLE construction
 * site, used by both `LineBuilder` and any card that lists the same rows.
 *
 * Lines belonging to this document, via the belongs_to rel
 * (`contact-tickets-tab.tsx` precedent — `operator: 'is'` + the RecordId; the
 * server strips the def prefix). Invoice mode ALSO excludes work-order source
 * lines stamped with `line_item_invoice` (the gather "invoiced by" pointer, money
 * MI1 build spec §B.3/§J.2) — only the invoice's own copies (workOrder empty) show.
 * work_order mode ALSO splits on `line_item_visitId` (plain-text bridge, dispatch
 * lock): a `visitId` → only that visit's occurrence extras; none → only the job's
 * per-cycle set (visitId empty), so extras never leak into the job Line-items tab.
 *
 * 🛑 It is a shared FUNCTION and not a per-caller literal for a reason that is
 * invisible at the call site: `createListKey` hashes `JSON.stringify(filters)`,
 * so the condition `id` STRINGS are part of the cache key. Two components asking
 * for the same rows with different ids land on two different `lists[...]` entries
 * — and `appendCreatedRecord(key, id)` patches only the ONE key that created the
 * record, while the acting tab is excluded from its own `record:created` frame.
 * The second list then never learns about the new row until a reload. Hand-rolling
 * this literal per caller is exactly how that happens, so don't.
 */
export function documentLineFilters(
  schema: LineSchema,
  documentRecordId: string,
  visitId?: string | null
): ConditionGroup[] {
  const conditions: ConditionGroup['conditions'] = [
    {
      id: 'line-builder-document',
      // The order and purchasing arms are the plainest: no work-order exclusion
      // (that invariant is about an invoice's own lines) and no visit split.
      fieldId: schema.relFieldId,
      operator: 'is',
      value: documentRecordId,
    },
  ]
  if (schema.capabilities.excludeWorkOrderSourceLines) {
    conditions.push({
      id: 'line-builder-invoice-workorder',
      fieldId: 'line_item:workOrder',
      operator: 'empty',
      value: null,
    })
  }
  if (schema.capabilities.visitScoped) {
    conditions.push(
      visitId
        ? { id: 'line-builder-visit', fieldId: 'line_item:visitId', operator: 'is', value: visitId }
        : {
            id: 'line-builder-visit',
            fieldId: 'line_item:visitId',
            operator: 'empty',
            value: null,
          }
    )
  }
  return [{ id: 'line-builder-baseline', logicalOperator: 'AND', conditions }]
}

/**
 * Page size every caller of {@link documentLineFilters} must share.
 *
 * `limit` rides on `useRecordList`'s tRPC query input, so a second reader that
 * pages differently gets a different React Query entry even when the store
 * `listKey` matches — half-shared, which is worse than either.
 */
export const LINE_PAGE_SIZE = 100

/** Stable sort ref shared by every line reader — see {@link LINE_PAGE_SIZE}. */
export const LINE_SORT = [{ id: 'sortOrder', desc: false }]

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
  lineTotal: null,
  purchaseOrderLineRecordId: null,
  glAccount: null,
  vendorPartRecordId: null,
  weight: null,
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
  lineTotal: FieldType.CURRENCY,
  purchaseOrderLineRecordId: FieldType.RELATIONSHIP,
  glAccount: FieldType.TEXT,
  vendorPartRecordId: FieldType.RELATIONSHIP,
  weight: FieldType.NUMBER,
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
 * Collapse a RELATIONSHIP read to the single prefixed record id a line cell wants.
 *
 * 🛑 `useSystemValues` collapses SINGLE_SELECT and single-value ACTOR to a scalar
 * but deliberately leaves the genuinely multi-value types — MULTI_SELECT, TAGS,
 * FILE and **RELATIONSHIP** — as arrays. A line's `part` is single-valued, so
 * reading it as a scalar hands a one-element ARRAY to everything downstream: the
 * cell wraps it again (`value={[partRecordId]}`), `RecordBadge` receives an array
 * where it expects an id, and the badge renders a permanent loading skeleton
 * instead of the part's name. Nothing throws and nothing logs — the part is
 * simply never visible on any purchasing line.
 */
/**
 * Read a NUMBER system value as a number, keeping the empty/zero distinction.
 *
 * 🛑 Absence must not be encoded as zero. The `weight` allocation basis divides
 * by the SUM of the set, so an unweighed line reported as `0` reads as a
 * deliberate weighs-nothing — the "some lines weighed, some not" state
 * `allocateCapitalisedCost` refuses. `null` means nobody has said yet, and it is
 * what lets the cell render its blank rather than a confident `0`.
 *
 * Numeric strings are accepted because `useSystemValues` returns one on some
 * paths and a bare number on others; a raw cast would put a string into the
 * arithmetic.
 */
export function numberOrNull(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function firstRecordId(raw: unknown): RecordId | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? (value as RecordId) : null
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
  const readRecordId = (key: keyof LineValues): RecordId | null => firstRecordId(read<unknown>(key))
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
    partRecordId: readRecordId('partRecordId'),
    lineTotal: read<number | null>('lineTotal') ?? null,
    purchaseOrderLineRecordId: readRecordId('purchaseOrderLineRecordId'),
    glAccount: read<string | null>('glAccount') ?? null,
    vendorPartRecordId: readRecordId('vendorPartRecordId'),
    // Coerced rather than cast: a NUMBER value reads back as a bare number on
    // most paths and as a numeric STRING on others, and `0` is a legitimate
    // weight — so `?? null` on a raw read would keep a string in a field the
    // allocation sums.
    weight: numberOrNull(read<unknown>('weight')),
  }
}

/**
 * Fill the sibling of whichever of rate / amount was just typed — the bidirectional
 * amount cell (plans/purchasing/04-vendor-bill-lines-and-the-amount-cell.md §3.5,
 * widened to the purchase order's `derived-editable` cell by
 * plans/money/tasks/31-sub-cent-rates.md §2.6).
 *
 * 🛑 ONE rule, and every arm below is that rule: **cross-fill only ever fills a
 * BLANK sibling. It never overwrites a value already entered.** On a vendor bill
 * all three of qty / rate / amount are transcribed from the vendor's document, and
 * a pass that "corrected" one of them from the other two would erase the
 * discrepancy the three-way match exists to find. Where they disagree the row
 * renders a mismatch marker instead; see `LineTotalCellView`.
 *
 * A no-op on every plain `derived` document, where the amount is the server's to
 * write and there is nothing to back-solve into.
 *
 * On `derived-editable` (the purchase order) the amount → rate arm rounds to
 * `RATE_DECIMALS`, not whole cents - `roundCents(167370 / 105000)` is `2`, but
 * `roundMinor(167370 / 105000, RATE_DECIMALS)` is the vendor's own `1.594`. The
 * rate → amount arm is a no-op there: `…_line_total` is engine-derived
 * (`computeLineTotal`), never a field this schema can write - see AmountMode.
 *
 * @param patch what the cell just committed
 * @param line the row's values BEFORE the patch
 * @returns `patch`, plus at most one filled-in sibling
 */
export function crossFillAmount(patch: LinePatch, line: LineValues, schema: LineSchema): LinePatch {
  if (schema.amountMode !== 'stored' && schema.amountMode !== 'derived-editable') return patch
  const qty = patch.qty ?? line.qty

  if (Object.hasOwn(patch, 'lineTotal') && !Object.hasOwn(patch, 'unitPriceCents')) {
    const lineTotal = patch.lineTotal ?? null
    // `qty > 0` is a division guard, not a policy: a zero-quantity line has no
    // per-unit price to derive and typing one anyway would divide by zero.
    if (lineTotal !== null && line.unitPriceCents === null && qty > 0) {
      const unitPriceCents =
        schema.amountMode === 'derived-editable'
          ? roundMinor(lineTotal / qty, RATE_DECIMALS)
          : roundCents(lineTotal / qty)
      return { ...patch, unitPriceCents }
    }
    return patch
  }

  if (Object.hasOwn(patch, 'unitPriceCents') && !Object.hasOwn(patch, 'lineTotal')) {
    // `derived-editable`: the total has no field to fill - the engine derives it
    // from qty x rate at render time. See AmountMode.
    if (schema.amountMode === 'derived-editable') return patch
    const unitPriceCents = patch.unitPriceCents ?? null
    if (unitPriceCents !== null && line.lineTotal === null) {
      return { ...patch, lineTotal: computeLineTotal(qty, unitPriceCents) }
    }
  }
  return patch
}

/**
 * Whether a stored amount disagrees with `qty × rate` — rendered, never fixed.
 *
 * `false` unless all three are present: a line still being transcribed is not in
 * disagreement with itself, it is simply incomplete.
 *
 * `stored` only. A `derived-editable` line has no persisted amount to compare -
 * `LineTotalCellView` computes that mismatch itself, from what was last typed
 * into the cell, because there is no field for this function to read.
 */
export function hasAmountMismatch(line: LineValues, schema: LineSchema): boolean {
  if (schema.amountMode !== 'stored') return false
  if (line.lineTotal === null || line.unitPriceCents === null) return false
  return computeLineTotal(line.qty, line.unitPriceCents) !== line.lineTotal
}
