// packages/lib/src/money/totals-hooks.ts

import type { Database } from '@auxx/database'
import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { extractFieldValueScalar } from '../field-values/field-value-scalar'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { syncInvoicePaymentState } from './payments/ledger'
import { computeDocumentTotals, computeLineTotal, roundCents } from './totals'
import type {
  DiscountType,
  DocumentBillingInputs,
  LineForTotals,
  RecomputeTotalsInput,
} from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Fields on `line-items` whose write should trigger a recompute (money MQ1 build
 * spec §F.2). The rel triggers (`line_item_quote` / `line_item_work_order`) catch
 * attach/detach side effects — a line just linked to a quote needs its contribution
 * folded into that quote's totals. Exported so the finalize integrity passes
 * (`events/handlers/finalize-integrity-passes.ts`) can match manifest change keys
 * against the exact same trigger vocabulary as this hook.
 */
export const LINE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'line_item_qty',
  'line_item_unit_price',
  'line_item_taxable',
  'line_item_discount',
  'line_item_optional', // selection toggles a line's contribution, not its own total (plan 18 §2)
  'line_item_optional_selected',
  'line_item_quote',
  'line_item_work_order',
  'line_item_invoice', // attach/detach recomputes the invoice (money MI1 build spec §G.1)
  'line_item_order', // attach/detach recomputes the order (08 §5.4)
])

/** Subset of {@link LINE_TRIGGER_ATTRS} that also requires rewriting `line_item_line_total`. */
export const LINE_TOTAL_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'line_item_qty',
  'line_item_unit_price',
])

/** Fields on `quotes` whose write should trigger a recompute (money MQ1 build spec §F.2). */
export const QUOTE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_rate',
])

/** Fields on `invoices` whose write should trigger a recompute (money MI1 build spec §G.1). */
export const INVOICE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_rate',
])

/** Fields on `orders` whose write should trigger a recompute (08 §5.4). */
export const ORDER_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'order_discount_type',
  'order_discount_value',
  'order_tax_rate',
])

/**
 * Fields on `purchase-orders` whose write should trigger a recompute
 * (plans/purchasing/01-build-plan.md §4.1).
 *
 * Note what is NOT here and what is: a PO has no `_discount_type` and no `_tax_rate`
 * (a supplier discount arrives as a flat number and a supplier states their tax, they
 * do not quote us a rate), but it DOES have `_shipping_total` and `_tax_total` as human
 * inputs that land in the total. Deriving these names from `attrPrefix` the way the three
 * sell-side sets are derived would produce three attributes that do not exist.
 */
export const PURCHASE_ORDER_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'purchase_order_discount_value',
  'purchase_order_shipping_total',
  'purchase_order_tax_total',
])

/** Fields on `purchase-order-lines` whose write should trigger a recompute (§4.2). */
export const PURCHASE_ORDER_LINE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_purchase_order',
])

/** Subset of the above that also requires rewriting `purchase_order_line_line_total`. */
export const PURCHASE_ORDER_LINE_TOTAL_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_expected_unit_price',
])

/** The **totalled** documents. `work_order` owns lines but stores no totals; so does `vendor_bill`,
 * whose totals are TRANSCRIBED from the supplier's document rather than computed (01 §5.4b) —
 * recomputing them would silently correct the arithmetic error the three-way match exists to find. */
export type TotalledDocumentType = 'quote' | 'invoice' | 'order' | 'purchase_order'

/**
 * The line entity a document's totals are summed from, and the attributes that make up
 * one line's contribution. Parameterized rather than hardcoded to `line_item` because a
 * `purchase_order_line` is deliberately NOT a `line_item` (01 §4.2): it has a buy price
 * and none of the sell-side vocabulary.
 *
 * The three optional modifier attributes are the sell-side vocabulary. A buy-side line
 * simply omits them, and every read below is already `undefined`-guarded, so nothing needs
 * a document-type check to skip them.
 */
interface LineTotalsSpec {
  /** The line's `entityType`, for `listFiltered` and `toRecordId`. */
  lineEntityType: string
  qtyAttr: SystemAttribute
  unitPriceAttr: SystemAttribute
  lineTotalAttr: SystemAttribute
  taxableAttr?: SystemAttribute
  optionalAttr?: SystemAttribute
  optionalSelectedAttr?: SystemAttribute
}

/** Every sell-side document's lines are `line_item`s, so the four share one spec. */
const LINE_ITEM_TOTALS_SPEC: LineTotalsSpec = {
  lineEntityType: 'line_item',
  qtyAttr: 'line_item_qty',
  unitPriceAttr: 'line_item_unit_price',
  lineTotalAttr: 'line_item_line_total',
  taxableAttr: 'line_item_taxable',
  optionalAttr: 'line_item_optional',
  optionalSelectedAttr: 'line_item_optional_selected',
}

/** A purchasing line: quantity ordered, expected buy price. No taxable, no optional. */
const PURCHASE_ORDER_LINE_TOTALS_SPEC: LineTotalsSpec = {
  lineEntityType: 'purchase_order_line',
  qtyAttr: 'purchase_order_line_quantity_ordered',
  unitPriceAttr: 'purchase_order_line_expected_unit_price',
  lineTotalAttr: 'purchase_order_line_line_total',
}

/**
 * How a document's own header money fields fold into its total.
 *
 * ⚠️ These are LOOKUPS, not ternaries, for the reason spelled out at `LINE_SCHEMAS` in
 * `line-builder/line-values.ts`: `billingPrefix` was once
 * `documentType === 'invoice' ? 'invoice' : 'quote'`, which silently mapped every other
 * document to the QUOTE prefix — a document reading and writing another document's
 * `quote_tax_rate`. A new document type must never join a boolean-shaped expression.
 */
interface DocumentBillingSpec {
  /** Header attr holding the discount shape, or `null` when the document has only one. */
  discountTypeAttr: SystemAttribute | null
  /** Used when `discountTypeAttr` is `null`. */
  fixedDiscountType: DiscountType | null
  discountValueAttr: SystemAttribute
  /** Header attr holding the tax RATE percent, or `null` when the document states an amount. */
  taxRateAttr: SystemAttribute | null
  /**
   * Header attrs whose STATED amounts are added on top of the computed total. Empty on the
   * sell side, where freight and tax are either lines or derived from a rate.
   */
  statedAdditionAttrs: SystemAttribute[]
  /** Whether the engine writes `<prefix>_tax_total`. False when it is a human input. */
  writesTaxTotal: boolean
}

/** The sell-side billing shape: a typed discount plus a tax rate, both on the header. */
function rateBilling(prefix: 'quote' | 'invoice' | 'order'): DocumentBillingSpec {
  return {
    discountTypeAttr: `${prefix}_discount_type` as SystemAttribute,
    fixedDiscountType: null,
    discountValueAttr: `${prefix}_discount_value` as SystemAttribute,
    taxRateAttr: `${prefix}_tax_rate` as SystemAttribute,
    statedAdditionAttrs: [],
    writesTaxTotal: true,
  }
}

/**
 * Per-document knobs for {@link recomputeDocumentTotals} (08 §5.4). Everything else —
 * the billing read, the line read, `computeDocumentTotals`, the mirror write — is shared,
 * and the systemAttribute names are all derived from `attrPrefix`.
 */
interface DocumentTotalsSpec {
  /** systemAttribute + field-id prefix: `quote_discount_type`, `quote_subtotal`, … */
  attrPrefix: TotalledDocumentType
  /** Which entity this document's lines are, and which attributes they carry. */
  line: LineTotalsSpec
  /** How the header's own money fields fold into the total. */
  billing: DocumentBillingSpec
  /** The line's owning relation, as a resource field id. */
  lineRelFieldId: string
  /** Extra conditions ANDed onto the line query. */
  extraLineConditions: Array<{
    id: string
    fieldId: string
    operator: 'is' | 'empty'
    value: string | null
  }>
  /**
   * Passed straight through to `setValuesForEntity`. `true` forces a publish (the
   * builder's totals footer updates via realtime); **`undefined` is not the same as
   * `false`** — undefined means "publish unless the session is declared silent"
   * (`field-value-mutations.ts:2667`), which is what the invoice path has always done.
   */
  publishEvents?: boolean
  /** Optional trailing side effect, run after the mirrors are written. */
  afterWrite?: (params: {
    organizationId: string
    userId: string
    documentInstanceId: string
    db?: Database
  }) => Promise<void>
}

const DOCUMENT_TOTALS_SPECS: Record<TotalledDocumentType, DocumentTotalsSpec> = {
  quote: {
    attrPrefix: 'quote',
    line: LINE_ITEM_TOTALS_SPEC,
    billing: rateBilling('quote'),
    lineRelFieldId: 'line_item:quote',
    extraLineConditions: [],
    publishEvents: true,
  },
  invoice: {
    attrPrefix: 'invoice',
    line: LINE_ITEM_TOTALS_SPEC,
    billing: rateBilling('invoice'),
    lineRelFieldId: 'line_item:invoice',
    // The §B.3 invariant: an invoice's own lines never carry a work order, so a WO
    // source line stamped with `line_item_invoice` must not contribute twice.
    extraLineConditions: [
      {
        id: 'invoice-lines-workorder',
        fieldId: 'line_item:workOrder',
        operator: 'empty',
        value: null,
      },
    ],
    // Deliberately left undefined — see the field doc above.
    // A total change can move `balance` and flip `paid` ↔ `partially_paid` even
    // though no payment was recorded (§E.4).
    afterWrite: ({ organizationId, userId, documentInstanceId, db }) =>
      syncInvoicePaymentState({
        organizationId,
        userId,
        invoiceInstanceId: documentInstanceId,
        db,
      }),
  },
  order: {
    attrPrefix: 'order',
    line: LINE_ITEM_TOTALS_SPEC,
    billing: rateBilling('order'),
    lineRelFieldId: 'line_item:order',
    // The plainest of the three: no work-order exclusion (that invariant is about an
    // invoice's own lines) and no payment ledger (08 §5.4).
    extraLineConditions: [],
    publishEvents: true,
  },
  purchase_order: {
    attrPrefix: 'purchase_order',
    line: PURCHASE_ORDER_LINE_TOTALS_SPEC,
    // The buy-side shape (01 §4.1). A supplier discount is a flat amount — there is no
    // `purchase_order_discount_type` field to read a shape from — and freight and tax
    // arrive STATED on the header rather than derived from a rate, so both are added on
    // top and `purchase_order_tax_total` stays a human input the engine must not overwrite.
    billing: {
      discountTypeAttr: null,
      fixedDiscountType: 'amount',
      discountValueAttr: 'purchase_order_discount_value',
      taxRateAttr: null,
      statedAdditionAttrs: ['purchase_order_shipping_total', 'purchase_order_tax_total'],
      writesTaxTotal: false,
    },
    lineRelFieldId: 'purchase_order_line:purchaseOrder',
    extraLineConditions: [],
    publishEvents: true,
  },
}

/**
 * Recompute a totalled document's `subtotal`/`taxTotal`/`total` from its current lines +
 * billing fields and write the mirrors via `FieldValueService`. The single source of truth
 * for "what are this document's totals right now" — called by both the field-change hooks
 * below and the `money.recomputeTotals` router mutation (delete path + drift escape,
 * §F.2/§G.2).
 *
 * Generalized across quote/invoice/order (08 §5.4): the quote and invoice branches were
 * ~110-line near-duplicates differing in three places, which {@link DOCUMENT_TOTALS_SPECS}
 * now names explicitly. The legacy `{ quoteInstanceId }` shape (no `documentType`/
 * `documentInstanceId`) is still accepted so existing quote call sites keep compiling.
 */
export async function recomputeTotals(
  input: RecomputeTotalsInput & { db?: Database }
): Promise<void> {
  const { organizationId, userId } = input
  const documentType = input.documentType ?? 'quote'
  const documentInstanceId = input.documentInstanceId ?? input.quoteInstanceId
  if (!documentInstanceId) {
    throw new BadRequestError(
      'recomputeTotals requires a documentInstanceId (or legacy quoteInstanceId)'
    )
  }

  await recomputeDocumentTotals({
    organizationId,
    userId,
    documentType,
    documentInstanceId,
    db: input.db,
  })
}

/** The one parameterized recompute behind every document type. */
async function recomputeDocumentTotals(params: {
  organizationId: string
  userId: string
  documentType: TotalledDocumentType
  documentInstanceId: string
  db?: Database
}): Promise<void> {
  const { organizationId, userId, documentType, documentInstanceId, db } = params
  const spec = DOCUMENT_TOTALS_SPECS[documentType]
  const documentRecordId = toRecordId(documentType, documentInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  const cache = getOrgCache()

  const headerAttrs = [
    spec.billing.discountTypeAttr,
    spec.billing.discountValueAttr,
    spec.billing.taxRateAttr,
    ...spec.billing.statedAdditionAttrs,
  ].filter((a): a is SystemAttribute => a !== null)

  /**
   * The mirrors this engine writes. Read in the SAME `getFieldValues` call as the
   * billing inputs — same query, more ids, no extra round trip — so the write can be
   * skipped when nothing moved (`purchase-order-line-rollups.ts:288` does the same for
   * its single roll-up value).
   *
   * `_tax_total` is listed only when the engine OWNS it: a PO's is a human input
   * (`writesTaxTotal: false`), and reading it here to compare against a number we never
   * write would refuse every no-op.
   */
  const mirrorAttrs: SystemAttribute[] = [
    `${spec.attrPrefix}_subtotal` as SystemAttribute,
    `${spec.attrPrefix}_total` as SystemAttribute,
    ...(spec.billing.writesTaxTotal ? [`${spec.attrPrefix}_tax_total` as SystemAttribute] : []),
  ]

  const lineAttrs = [
    spec.line.lineTotalAttr,
    spec.line.taxableAttr,
    spec.line.optionalAttr,
    spec.line.optionalSelectedAttr,
  ].filter((a): a is SystemAttribute => a !== undefined)

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([...headerAttrs, ...mirrorAttrs, ...lineAttrs])

  const discountTypeField = spec.billing.discountTypeAttr
    ? cf[spec.billing.discountTypeAttr]
    : undefined
  const discountValueField = cf[spec.billing.discountValueAttr]
  const taxRateField = spec.billing.taxRateAttr ? cf[spec.billing.taxRateAttr] : undefined

  const headerFieldIds = [...headerAttrs, ...mirrorAttrs]
    .map((a) => cf[a]?.id)
    .filter((id): id is string => !!id)
  const headerValues = await handler.getFieldValues(documentRecordId, headerFieldIds)

  const readNumber = (fieldId: string | undefined): number | null => {
    if (!fieldId) return null
    const typed = firstTyped(headerValues.get(fieldId))
    return typed ? (extractValue(typed) as number) : null
  }

  const discountTypeTyped = discountTypeField
    ? firstTyped(headerValues.get(discountTypeField.id))
    : undefined

  const billing: DocumentBillingInputs = {
    // A document with no `_discount_type` field carries a single fixed shape (a supplier
    // discount is always a flat amount), never the quote's default by accident.
    discountType: discountTypeTyped
      ? (extractValue(discountTypeTyped) as DiscountType)
      : spec.billing.fixedDiscountType,
    discountValue: readNumber(discountValueField?.id),
    taxRate: readNumber(taxRateField?.id),
  }

  // Stated header amounts (buy-side freight + tax). Empty on the sell side, so this sums
  // to 0 and the three existing documents keep their arithmetic byte-for-byte.
  const statedAdditions = spec.billing.statedAdditionAttrs.reduce(
    (sum, attr) => sum + (readNumber(cf[attr]?.id) ?? 0),
    0
  )

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: spec.line.lineEntityType,
    filters: [
      {
        id: `${documentType}-lines`,
        logicalOperator: 'AND',
        conditions: [
          {
            id: `${documentType}-lines-parent`,
            fieldId: spec.lineRelFieldId,
            operator: 'is',
            value: documentRecordId,
          },
          ...spec.extraLineConditions,
        ],
      },
    ],
    limit: 1000,
  })

  const lineTotalField = cf[spec.line.lineTotalAttr]
  const lines: LineForTotals[] = lineTotalField
    ? await readLinesForTotals(db, organizationId, spec, cf, lineInstanceIds)
    : []

  const totals = computeDocumentTotals(lines, billing)

  const values: Array<{ fieldId: string; value: number }> = [
    { fieldId: `${spec.attrPrefix}_subtotal`, value: totals.subtotal },
    { fieldId: `${spec.attrPrefix}_total`, value: roundCents(totals.total + statedAdditions) },
  ]
  // Only when the engine owns it. A PO's `tax_total` is typed off the supplier's
  // acknowledgement and is an INPUT to the total, so writing a derived 0 over it would
  // both destroy the entry and drop it from the total on the next recompute.
  if (spec.billing.writesTaxTotal) {
    values.push({ fieldId: `${spec.attrPrefix}_tax_total`, value: totals.taxTotal })
  }

  /**
   * Skip a write that would store what is already stored.
   *
   * The hook fires once per changed FIELD, and several of its triggers move no total at
   * all — `line_item_taxable` on a document with no tax rate, a rel write that re-links a
   * line to the parent it already had, the second of two attributes set in one line write.
   * Each of those previously re-entered the field-value layer, the realtime publisher and
   * the sync manifest to store an identical number.
   *
   * Conservative by construction: unless EVERY value is already present and equal, the
   * write happens. A mirror the org has not materialised has no field id, so `readNumber`
   * returns null, nothing matches, and the write proceeds exactly as before.
   *
   * 🛑 `afterWrite` still runs. `syncInvoicePaymentState` reads more than these three
   * numbers — a payment recorded elsewhere moves `balance` and can flip
   * `paid` <-> `partially_paid` with the totals unchanged — and `money.recomputeTotals`
   * is documented as the manual drift escape, so it must stay a real refresh.
   */
  const unchanged = values.every((v) => {
    const current = readNumber(cf[v.fieldId as SystemAttribute]?.id)
    return current !== null && current === v.value
  })

  if (!unchanged) {
    const fieldValueService = new FieldValueService(organizationId, userId, db)
    await fieldValueService.setValuesForEntity({
      recordId: documentRecordId,
      values,
      publishEvents: spec.publishEvents,
    })
  }

  await spec.afterWrite?.({ organizationId, userId, documentInstanceId, db })
}

/**
 * Every line's contribution to its document, in ONE query per 200-id chunk.
 *
 * ⚠️ This replaced a serial `getFieldValues` per line — `await` inside a `for`
 * over an id list capped at 1000 — which made a 20-line document cost ~20
 * round trips per hook fire, and the hook fires once per changed FIELD. A
 * 20-line bulk paste therefore issued 40 recomputes, each re-reading every
 * line that existed so far. See `plans/events/08-derived-parent-reconciler-plan.md` §1.
 *
 * The read is deliberately raw + {@link extractFieldValueScalar} rather than
 * `FieldValueService.batchGetValues`, for the same two reasons
 * `purchase-order-line-rollups.ts` and `builds/auto-build-queries.ts` are
 * written this way: the field ids in hand are CustomField ids, where
 * `batchGetValues` validates `ResourceFieldId`s (`entity:key`) and would need a
 * key translation this has no reason to risk; and enforcement is unchanged
 * either way, because the handler this used to go through is constructed
 * without a `CapabilityView` and the line ids were already scoped by the
 * `listFiltered` above.
 *
 * One entry per id in `lineInstanceIds`, in that order, INCLUDING a line with no
 * stored values at all — the previous loop pushed an entry per id unconditionally
 * and `computeDocumentTotals` counts a null `lineTotal` as a zero contribution.
 */
async function readLinesForTotals(
  db: Database | undefined,
  organizationId: string,
  spec: DocumentTotalsSpec,
  cf: Partial<Record<SystemAttribute, { id: string } | null>>,
  lineInstanceIds: string[]
): Promise<LineForTotals[]> {
  if (lineInstanceIds.length === 0) return []

  const idFor = (attr: SystemAttribute | undefined): string | undefined =>
    attr ? (cf[attr]?.id ?? undefined) : undefined

  const lineTotalFieldId = idFor(spec.line.lineTotalAttr)
  const taxableFieldId = idFor(spec.line.taxableAttr)
  const optionalFieldId = idFor(spec.line.optionalAttr)
  const optionalSelectedFieldId = idFor(spec.line.optionalSelectedAttr)

  const fieldIds = [
    lineTotalFieldId,
    taxableFieldId,
    optionalFieldId,
    optionalSelectedFieldId,
  ].filter((id): id is string => !!id)
  if (fieldIds.length === 0) return lineInstanceIds.map(() => emptyLineForTotals())

  const conn = db ?? database
  // `fieldId -> value` per line. A line absent from the map stored nothing.
  const byLine = new Map<string, Map<string, unknown>>()

  // Bounded IN-list, same 200 as `record-rules/snapshot-fetcher.ts`. A document
  // is capped at 1000 lines by the `listFiltered` above, so this is <= 5 queries
  // for the largest document that can exist, against 1000 before.
  const CHUNK = 200
  for (let i = 0; i < lineInstanceIds.length; i += CHUNK) {
    const chunk = lineInstanceIds.slice(i, i + CHUNK)
    const rows = await conn
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, chunk),
          inArray(schema.FieldValue.fieldId, fieldIds)
        )
      )

    for (const row of rows) {
      let values = byLine.get(row.entityId)
      if (!values) {
        values = new Map()
        byLine.set(row.entityId, values)
      }
      values.set(row.fieldId, extractFieldValueScalar(row as unknown as Record<string, unknown>))
    }
  }

  return lineInstanceIds.map((lineInstanceId) => {
    const values = byLine.get(lineInstanceId)
    if (!values) return emptyLineForTotals()

    const read = (fieldId: string | undefined): unknown =>
      fieldId && values.has(fieldId) ? values.get(fieldId) : undefined

    const lineTotal = read(lineTotalFieldId)
    const taxable = read(taxableFieldId)
    const optional = read(optionalFieldId)
    const optionalSelected = read(optionalSelectedFieldId)

    return {
      lineTotal: lineTotal == null ? null : (lineTotal as number),
      // A line entity with no `taxable` field is wholly taxable as far as the math is
      // concerned — with `taxRate` null (the buy side) that distinction never surfaces.
      taxable: taxable == null ? true : (taxable as boolean),
      optional: optional == null ? undefined : (optional as boolean),
      optionalSelected: optionalSelected == null ? undefined : (optionalSelected as boolean),
    }
  })
}

/** A line the query returned nothing for — the previous loop's all-absent case. */
function emptyLineForTotals(): LineForTotals {
  return { lineTotal: null, taxable: true, optional: undefined, optionalSelected: undefined }
}

/**
 * Recompute + write a single line's `line_item_line_total` from its current qty/unitPrice
 * (`publishEvents` ON — the builder's lineTotal cell updates via realtime). Extracted from
 * {@link recomputeOnLineChange} step 1 so the finalize integrity passes can run it per
 * imported/synced line; behavior is identical to the hook's inline version. No-ops when the
 * org lacks the qty/unitPrice fields.
 */
export async function recomputeLineTotal(params: {
  organizationId: string
  userId: string
  lineInstanceId: string
  /** Defaults to `line_item` — the finalize integrity passes call it that way. */
  line?: LineTotalsSpec
}): Promise<void> {
  const { organizationId, userId, lineInstanceId } = params
  const line = params.line ?? LINE_ITEM_TOTALS_SPEC
  const lineRecordId = toRecordId(line.lineEntityType, lineInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)

  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([line.qtyAttr, line.unitPriceAttr])
  const qtyField = cf[line.qtyAttr]
  const unitPriceField = cf[line.unitPriceAttr]
  if (!qtyField || !unitPriceField) return

  const values = await handler.getFieldValues(lineRecordId, [qtyField.id, unitPriceField.id])
  const qtyTyped = firstTyped(values.get(qtyField.id))
  const unitPriceTyped = firstTyped(values.get(unitPriceField.id))
  const qty = qtyTyped ? (extractValue(qtyTyped) as number) : 0
  const unitPrice = unitPriceTyped ? (extractValue(unitPriceTyped) as number) : null

  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: lineRecordId,
    values: [{ fieldId: line.lineTotalAttr, value: computeLineTotal(qty, unitPrice) }],
    publishEvents: true,
  })
}

/**
 * Resolve which document a line's contribution folds into — the parent quote, else the
 * parent invoice but ONLY when `line_item_work_order` is empty (§B.3/§G.1: a WO source
 * line stamped with `line_item_invoice` must never recompute the invoice; only the
 * invoice's own copies do). Extracted from {@link recomputeOnLineChange} steps 2-3 —
 * same reads, same precedence — so the finalize integrity passes can collect DISTINCT
 * parents across a run before recomputing each once. Returns null when the line hangs
 * off no recomputable document.
 */
export async function resolveLineParentDocument(params: {
  organizationId: string
  userId: string
  lineInstanceId: string
}): Promise<{ documentType: TotalledDocumentType; documentInstanceId: string } | null> {
  const { organizationId, userId, lineInstanceId } = params
  const lineRecordId = toRecordId('line_item', lineInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)

  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'line_item_quote',
      'line_item_invoice',
      'line_item_order',
      'line_item_work_order',
    ] as const)

  // Resolve the parent quote — work_order lines have no stored totals in MQ1, skip.
  if (cf.line_item_quote) {
    const quoteValues = await handler.getFieldValues(lineRecordId, [cf.line_item_quote.id])
    const quoteTyped = firstTyped(quoteValues.get(cf.line_item_quote.id))
    if (quoteTyped?.type === 'relationship' && quoteTyped.recordId) {
      const { entityInstanceId: quoteInstanceId } = parseRecordId(quoteTyped.recordId)
      return { documentType: 'quote', documentInstanceId: quoteInstanceId }
    }
  }

  // Resolve the parent invoice — ONLY when this line has no work order (§B.3/§G.1): a
  // WO source line stamped with `line_item_invoice` must never recompute the invoice.
  if (cf.line_item_invoice && cf.line_item_work_order) {
    const relValues = await handler.getFieldValues(lineRecordId, [
      cf.line_item_invoice.id,
      cf.line_item_work_order.id,
    ])
    const invoiceTyped = firstTyped(relValues.get(cf.line_item_invoice.id))
    const workOrderTyped = firstTyped(relValues.get(cf.line_item_work_order.id))
    const hasWorkOrder = workOrderTyped?.type === 'relationship' && !!workOrderTyped.recordId
    if (!hasWorkOrder && invoiceTyped?.type === 'relationship' && invoiceTyped.recordId) {
      const { entityInstanceId: invoiceInstanceId } = parseRecordId(invoiceTyped.recordId)
      return { documentType: 'invoice', documentInstanceId: invoiceInstanceId }
    }
  }

  // Resolve the parent order (08 §5.4). Last in precedence because it is the newest
  // slot and the only one a line can hold alongside nothing else — an order line is
  // never also a quote or invoice line.
  if (cf.line_item_order) {
    const orderValues = await handler.getFieldValues(lineRecordId, [cf.line_item_order.id])
    const orderTyped = firstTyped(orderValues.get(cf.line_item_order.id))
    if (orderTyped?.type === 'relationship' && orderTyped.recordId) {
      const { entityInstanceId: orderInstanceId } = parseRecordId(orderTyped.recordId)
      return { documentType: 'order', documentInstanceId: orderInstanceId }
    }
  }

  return null
}

/**
 * Recompute hook for `line-items` (money MQ1 build spec §F.2, registered under the
 * `line-items` apiSlug in `field-hooks/register-hooks.ts`). Steps:
 *
 * 1. If `qty`/`unitPrice` changed, recompute + write `line_item_line_total`
 *    ({@link recomputeLineTotal}).
 * 2. Resolve the line's parent document ({@link resolveLineParentDocument}: quote first,
 *    else invoice-without-work-order) and recompute+write its mirrored totals.
 *
 * No recursion: the fields this hook writes (`line_total`, `subtotal`/`tax_total`/
 * `total`) are not in {@link LINE_TRIGGER_ATTRS}, {@link QUOTE_TRIGGER_ATTRS}, or
 * {@link INVOICE_TRIGGER_ATTRS}, so re-entry exits immediately on the systemAttribute filter.
 */
export const recomputeOnLineChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !LINE_TRIGGER_ATTRS.has(attr)) return

  const { organizationId, userId } = event
  const { entityInstanceId: lineInstanceId } = parseRecordId(event.recordId)

  if (LINE_TOTAL_TRIGGER_ATTRS.has(attr)) {
    await recomputeLineTotal({ organizationId, userId, lineInstanceId })
  }

  const parent = await resolveLineParentDocument({ organizationId, userId, lineInstanceId })
  if (parent) {
    await recomputeTotals({
      organizationId,
      userId,
      documentType: parent.documentType,
      documentInstanceId: parent.documentInstanceId,
    })
  }
}

/**
 * Recompute hook for `quotes` (money MQ1 build spec §F.2, registered under the
 * `quotes` apiSlug). Fires when the quote's own billing fields change
 * (discount type/value, tax rate) and recomputes+writes its mirrored totals.
 */
export const recomputeOnQuoteBillingChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !QUOTE_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: quoteInstanceId } = parseRecordId(event.recordId)
  await recomputeTotals({
    organizationId: event.organizationId,
    userId: event.userId,
    documentType: 'quote',
    documentInstanceId: quoteInstanceId,
  })
}

/**
 * Recompute hook for `invoices` (money MI1 build spec §G.1, registered under the `invoices`
 * apiSlug). Fires when the invoice's own billing fields change (discount type/value, tax
 * rate) and recomputes+writes its mirrored totals.
 */
export const recomputeOnInvoiceBillingChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !INVOICE_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: invoiceInstanceId } = parseRecordId(event.recordId)
  await recomputeTotals({
    organizationId: event.organizationId,
    userId: event.userId,
    documentType: 'invoice',
    documentInstanceId: invoiceInstanceId,
  })
}

/**
 * Recompute hook for `orders` (08 §5.4, registered under the `orders` apiSlug). Fires when
 * the order's own billing fields change (discount type/value, tax rate) and recomputes +
 * writes its mirrored totals.
 */
export const recomputeOnOrderBillingChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !ORDER_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: orderInstanceId } = parseRecordId(event.recordId)
  await recomputeTotals({
    organizationId: event.organizationId,
    userId: event.userId,
    documentType: 'order',
    documentInstanceId: orderInstanceId,
  })
}

/**
 * Recompute hook for `purchase-order-lines` (plans/purchasing/01-build-plan.md §4.2,
 * registered under the `purchase-order-lines` apiSlug). Structurally the buy-side twin of
 * {@link recomputeOnLineChange}: rewrite the line's own total when qty/price move, then
 * recompute the parent PO's mirrors.
 *
 * The parent resolution is one read rather than {@link resolveLineParentDocument}'s ladder
 * because a `purchase_order_line` has exactly one possible parent — it is not a `line_item`
 * and can never hang off a quote, invoice, order or work order.
 *
 * No recursion: `purchase_order_line_line_total`, `purchase_order_subtotal` and
 * `purchase_order_total` are in neither trigger set, so re-entry exits on the filter.
 */
export const recomputeOnPurchaseOrderLineChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !PURCHASE_ORDER_LINE_TRIGGER_ATTRS.has(attr)) return

  const { organizationId, userId } = event
  const { entityInstanceId: lineInstanceId } = parseRecordId(event.recordId)

  if (PURCHASE_ORDER_LINE_TOTAL_TRIGGER_ATTRS.has(attr)) {
    await recomputeLineTotal({
      organizationId,
      userId,
      lineInstanceId,
      line: PURCHASE_ORDER_LINE_TOTALS_SPEC,
    })
  }

  const purchaseOrderInstanceId = await resolvePurchaseOrderForLine({
    organizationId,
    userId,
    lineInstanceId,
  })
  if (purchaseOrderInstanceId) {
    await recomputeTotals({
      organizationId,
      userId,
      documentType: 'purchase_order',
      documentInstanceId: purchaseOrderInstanceId,
    })
  }
}

/** Resolve the purchase order a PO line belongs to. Null when the line is orphaned. */
async function resolvePurchaseOrderForLine(params: {
  organizationId: string
  userId: string
  lineInstanceId: string
}): Promise<string | null> {
  const { organizationId, userId, lineInstanceId } = params
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['purchase_order_line_purchase_order'] as const)
  const relField = cf.purchase_order_line_purchase_order
  if (!relField) return null

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const lineRecordId = toRecordId(PURCHASE_ORDER_LINE_TOTALS_SPEC.lineEntityType, lineInstanceId)
  const values = await handler.getFieldValues(lineRecordId, [relField.id])
  const typed = firstTyped(values.get(relField.id))
  if (typed?.type !== 'relationship' || !typed.recordId) return null
  return parseRecordId(typed.recordId).entityInstanceId
}

/**
 * Recompute hook for `purchase-orders` (§4.1, registered under the `purchase-orders`
 * apiSlug). Fires when the order's own stated money fields change — the flat discount, the
 * freight and the supplier's stated tax — and rewrites `subtotal` + `total`.
 */
export const recomputeOnPurchaseOrderBillingChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !PURCHASE_ORDER_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: purchaseOrderInstanceId } = parseRecordId(event.recordId)
  await recomputeTotals({
    organizationId: event.organizationId,
    userId: event.userId,
    documentType: 'purchase_order',
    documentInstanceId: purchaseOrderInstanceId,
  })
}
