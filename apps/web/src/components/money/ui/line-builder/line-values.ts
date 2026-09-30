// apps/web/src/components/money/ui/line-builder/line-values.ts

import {
  type CreateLineInput,
  crossFillAmount as crossFillLine,
  hasAmountMismatch as hasLineAmountMismatch,
  type Line,
  type LineKey,
  type LineKind,
  type LinePatch as LineWritePatch,
  pickWritablePatch,
} from '@auxx/lib/accounting/documents/lines/client'
import type { LineItemUnit } from '@auxx/lib/accounting/sales/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'

/**
 * What one builder row edits: a {@link Line} in the row components' vocabulary, with the
 * display defaults applied and relationships as `RecordId`s for the pickers.
 */
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
  partRecordId: RecordId | null
  /** Read and written only where the kind stores its amount (`amountMode: 'stored'`). */
  lineTotal: number | null
  /** Buy-side only: the three-way match key. */
  purchaseOrderLineRecordId: RecordId | null
  /** Vendor bill only: the goods bill this line is a landed cost of (73 §7.2). */
  landedBillRecordId: RecordId | null
  /** Buy-side only: the account code this line posts to. */
  glAccount: string | null
  /** Purchase order only: provenance of the prefilled price, never a live price read. */
  vendorPartRecordId: RecordId | null
  /** Purchase order only: `null` is "not weighed", never zero. */
  weight: number | null
  returnsStock: boolean
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
  partRecordId: null,
  lineTotal: null,
  purchaseOrderLineRecordId: null,
  landedBillRecordId: null,
  glAccount: null,
  vendorPartRecordId: null,
  weight: null,
  returnsStock: false,
}

/** Semantic update emitted by a row; absent keys are not written. */
export type LinePatch = Partial<LineValues>

/** The entity def ids a line's relationship values are addressed under in the client stores. */
export type LineRelationDefs = Partial<
  Record<'part' | 'purchase_order_line' | 'vendor_bill' | 'vendor_part', string>
>

const LINE_VALUE_KEYS = Object.keys(DEFAULT_LINE_VALUES) as Array<keyof LineValues>

/** Return only values that changed between two line snapshots. */
export function diffLineValues(before: LineValues, after: LineValues): LinePatch {
  const patch: Record<string, unknown> = {}
  for (const key of LINE_VALUE_KEYS) {
    if (!Object.is(before[key], after[key])) patch[key] = after[key]
  }
  return patch as LinePatch
}

/** Read a NUMBER value as a number; `null` for absent, never `0` (the weight basis relies on it). */
export function numberOrNull(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function recordIdOf(defId: string | undefined, instanceId: string | null): RecordId | null {
  return defId && instanceId ? toRecordId(defId, instanceId) : null
}

function instanceIdOf(recordId: RecordId | null | undefined): string | null {
  return recordId ? parseRecordId(recordId).entityInstanceId : null
}

/** A cached {@link Line} as the row renders it. */
export function lineValuesFromLine(line: Line, kind: LineKind, defs: LineRelationDefs): LineValues {
  const supportsOptional = kind.capabilities.optional
  return {
    name: line.name ?? '',
    description: line.description,
    category: line.category,
    taxable: line.taxable !== false,
    qty: line.qty ?? 1,
    unit: line.unit,
    unitPriceCents: line.unitPrice,
    optional: supportsOptional && line.optional === true,
    optionalSelected: !supportsOptional || line.optionalSelected !== false,
    partRecordId: recordIdOf(defs.part, line.partId),
    lineTotal: kind.amountMode === 'stored' ? line.lineTotal : null,
    purchaseOrderLineRecordId: recordIdOf(defs.purchase_order_line, line.purchaseOrderLineId),
    landedBillRecordId: recordIdOf(defs.vendor_bill, line.landedBillId),
    glAccount: line.glAccountId,
    vendorPartRecordId: recordIdOf(defs.vendor_part, line.vendorPartId),
    weight: line.weight,
    returnsStock: line.returnsStock === true,
  }
}

/**
 * A row patch as the `lines` router takes it. Keys the kind cannot write (a PO's typed
 * amount, `taxable` on a buy-side line) are dropped, since the router refuses them.
 */
export function toLinePatch(patch: LinePatch, kind: LineKind): LineWritePatch {
  const out: Record<string, unknown> = {}
  const map = <K extends keyof LinePatch>(
    from: K,
    to: keyof LineWritePatch,
    convert?: (v: LinePatch[K]) => unknown
  ) => {
    if (Object.hasOwn(patch, from)) out[to] = convert ? convert(patch[from]) : patch[from]
  }
  map('name', 'name')
  map('description', 'description')
  map('category', 'category')
  map('taxable', 'taxable')
  map('qty', 'qty')
  map('unit', 'unit')
  map('unitPriceCents', 'unitPrice')
  map('optional', 'optional')
  map('optionalSelected', 'optionalSelected')
  map('partRecordId', 'partId', instanceIdOf)
  map('lineTotal', 'lineTotal')
  map('purchaseOrderLineRecordId', 'purchaseOrderLineId', instanceIdOf)
  map('landedBillRecordId', 'landedBillId', instanceIdOf)
  map('glAccount', 'glAccountId')
  map('vendorPartRecordId', 'vendorPartId', instanceIdOf)
  map('weight', 'weight')
  map('returnsStock', 'returnsStock')
  return pickWritablePatch(out as LineWritePatch, kind.documentType)
}

/** A draft's first create: blanks are left for the defaults, not sent. */
export function draftCreateInput(
  draft: LineValues,
  kind: LineKind,
  visitId: string | undefined
): CreateLineInput {
  const values: LinePatch = {
    qty: draft.qty,
    unit: draft.unit,
    taxable: draft.taxable,
    optional: draft.optional,
    optionalSelected: draft.optionalSelected,
  }
  if (draft.name) values.name = draft.name
  if (draft.description) values.description = draft.description
  if (draft.category) values.category = draft.category
  if (draft.unitPriceCents !== null) values.unitPriceCents = draft.unitPriceCents
  if (draft.partRecordId) values.partRecordId = draft.partRecordId
  if (draft.lineTotal !== null) values.lineTotal = draft.lineTotal
  if (draft.purchaseOrderLineRecordId) {
    values.purchaseOrderLineRecordId = draft.purchaseOrderLineRecordId
  }
  if (draft.landedBillRecordId) values.landedBillRecordId = draft.landedBillRecordId
  if (draft.glAccount) values.glAccount = draft.glAccount
  if (draft.vendorPartRecordId) values.vendorPartRecordId = draft.vendorPartRecordId
  if (draft.weight !== null) values.weight = draft.weight
  if (draft.returnsStock) values.returnsStock = true
  const input = toLinePatch(values, kind)
  return visitId && kind.capabilities.visitScoped ? { ...input, visitId } : input
}

/** The three amount keys the lines module's helpers read, in {@link Line} shape. */
function amountLine(values: LineValues): Line {
  return {
    qty: values.qty,
    unitPrice: values.unitPriceCents,
    lineTotal: values.lineTotal,
  } as Line
}

/** {@link crossFillLine} over a row's values: fill the sibling of whichever of rate / amount was typed. */
export function crossFillAmount(patch: LinePatch, line: LineValues, kind: LineKind): LinePatch {
  const amounts: LineWritePatch = {}
  if (Object.hasOwn(patch, 'qty')) amounts.qty = patch.qty
  if (Object.hasOwn(patch, 'unitPriceCents')) amounts.unitPrice = patch.unitPriceCents
  if (Object.hasOwn(patch, 'lineTotal')) amounts.lineTotal = patch.lineTotal
  const filled = crossFillLine(amounts, amountLine(line), kind)
  const out: LinePatch = { ...patch }
  if (Object.hasOwn(filled, 'unitPrice')) out.unitPriceCents = filled.unitPrice ?? null
  if (Object.hasOwn(filled, 'lineTotal')) out.lineTotal = filled.lineTotal ?? null
  return out
}

/** Whether a stored amount disagrees with `qty × rate`; rendered, never fixed. */
export function hasAmountMismatch(line: LineValues, kind: LineKind): boolean {
  return hasLineAmountMismatch(amountLine(line), kind)
}

/**
 * The line attributes the part cell gates its menu items on, `null` where the kind lacks the
 * concept. Only `part` is read as a real attribute (the picker loads its field def).
 */
export function partCellAttrs(kind: LineKind) {
  const attr = (key: LineKey, suffix: string) =>
    kind.fields.includes(key) ? `${kind.lineEntityType}_${suffix}` : null
  return {
    part: attr('partId', 'part'),
    matchKey: attr('purchaseOrderLineId', 'purchase_order_line'),
    landedBill: attr('landedBillId', 'landed_bill'),
    glAccount: attr('glAccountId', 'gl_account'),
    weight: attr('weight', 'weight'),
    returnsStock: attr('returnsStock', 'returns_stock'),
    vendorPart: attr('vendorPartId', 'vendor_part'),
  }
}
