// apps/web/src/components/money/ui/line-builder/line-values.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import type { LineItemUnit } from '@auxx/lib/money/client'
import type { RecordId } from '@auxx/lib/resources/client'

/**
 * The documents that own line items. Three of them are **totalled**
 * (`quote`, `invoice`, `order`); `work_order` owns lines but stores no totals
 * at all, which is why `hasBilling` is a knob rather than a `!== 'work_order'`
 * check. Declared here — the leaf of the line-builder module graph — so the
 * builder, the rows and the totals footer share one definition instead of
 * three hand-copied unions that can drift apart.
 * See plans/products/08-order-build.md §5.4/§5.6.
 */
export type DocumentType = 'quote' | 'work_order' | 'invoice' | 'order'

/**
 * Per-document knobs, keyed on {@link DocumentType}
 * (plans/products/08-order-build.md §5.6).
 *
 * ⚠️ These are LOOKUPS, not ternaries, and that is the whole point. `billingPrefix`
 * used to be `documentType === 'invoice' ? 'invoice' : 'quote'` — a two-way
 * expression that silently mapped `work_order`, and would have mapped `order`, to
 * the QUOTE prefix. An order reading and writing `quote_tax_rate` is exactly what
 * that shape produces, so a fourth document type must never be added to a
 * boolean-shaped expression. `totals-hooks.ts` uses the same shape server-side.
 *
 * Defined here, in the leaf of the line-builder module graph, because the builder,
 * the rows and the totals footer all need them — three hand-copied copies is how
 * the read prefix and the write prefix drift apart.
 *
 * `work_order` (M2 job view) stores no totals at all: its `billingPrefix` is never
 * read because every use is gated on `hasBilling`.
 */
export const DOCUMENT_KNOBS = {
  quote: {
    hasBilling: true,
    billingPrefix: 'quote',
    relKey: 'line_item_quote',
    relFieldId: 'line_item:quote',
  },
  invoice: {
    hasBilling: true,
    billingPrefix: 'invoice',
    relKey: 'line_item_invoice',
    relFieldId: 'line_item:invoice',
  },
  order: {
    hasBilling: true,
    billingPrefix: 'order',
    relKey: 'line_item_order',
    relFieldId: 'line_item:order',
  },
  work_order: {
    hasBilling: false,
    billingPrefix: 'quote',
    relKey: 'line_item_work_order',
    relFieldId: 'line_item:workOrder',
  },
} as const satisfies Record<
  DocumentType,
  { hasBilling: boolean; billingPrefix: string; relKey: string; relFieldId: string }
>

/** The document billing mirrors read for group set-if-unset checks and `TotalsFooter`. */
export const DOCUMENT_BILLING_ATTRS: Record<DocumentType, string[]> = {
  quote: ['quote_discount_type', 'quote_discount_value', 'quote_tax_name', 'quote_tax_rate'],
  invoice: [
    'invoice_discount_type',
    'invoice_discount_value',
    'invoice_tax_name',
    'invoice_tax_rate',
    // Invoice-only: the ledger-sync mirrors (§E.4) — read-only here.
    'invoice_amount_paid',
    'invoice_balance',
  ],
  order: ['order_discount_type', 'order_discount_value', 'order_tax_name', 'order_tax_rate'],
  work_order: [],
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
}

/** Semantic update emitted by a row; absent keys are not written. */
export type LinePatch = Partial<LineValues>

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
}

/** Fields every quote/work-order/invoice row renders. */
export const BASE_LINE_SYSTEM_ATTRIBUTES = [
  'line_item_name',
  'line_item_description',
  'line_item_category',
  'line_item_taxable',
  'line_item_qty',
  'line_item_unit',
  'line_item_unit_price',
  // Not part of `LineValues`/`linePatchToFieldValues` — the photo popover
  // (line-photo-popover.tsx) reads/writes this field directly via
  // `useFieldFileUpload`, not the semantic patch path. Riding along in the
  // same prefetch batch just gives the trigger its count for free
  // (plans 37b §4 / 40).
  'line_item_photos',
]

/** Quote-only selection fields appended to the base row values. */
export const QUOTE_LINE_SYSTEM_ATTRIBUTES = [
  ...BASE_LINE_SYSTEM_ATTRIBUTES,
  'line_item_optional',
  'line_item_optional_selected',
]

const LINE_FIELD_CONFIG: {
  [K in keyof LineValues]: { fieldId: string; fieldType: FieldTypeValue }
} = {
  name: { fieldId: 'line_item_name', fieldType: FieldType.TEXT },
  description: { fieldId: 'line_item_description', fieldType: FieldType.TEXT },
  category: { fieldId: 'line_item_category', fieldType: FieldType.SINGLE_SELECT },
  taxable: { fieldId: 'line_item_taxable', fieldType: FieldType.CHECKBOX },
  qty: { fieldId: 'line_item_qty', fieldType: FieldType.NUMBER },
  unit: { fieldId: 'line_item_unit', fieldType: FieldType.SINGLE_SELECT },
  unitPriceCents: { fieldId: 'line_item_unit_price', fieldType: FieldType.CURRENCY },
  optional: { fieldId: 'line_item_optional', fieldType: FieldType.CHECKBOX },
  optionalSelected: {
    fieldId: 'line_item_optional_selected',
    fieldType: FieldType.CHECKBOX,
  },
  catalogItemRecordId: {
    fieldId: 'line_item_catalog_item',
    fieldType: FieldType.RELATIONSHIP,
  },
}

const LINE_VALUE_KEYS = Object.keys(LINE_FIELD_CONFIG) as Array<keyof LineValues>

/** Convert a semantic patch into field-value mutation inputs. */
export function linePatchToFieldValues(patch: LinePatch): LineFieldValueUpdate[] {
  const updates: LineFieldValueUpdate[] = []
  for (const key of LINE_VALUE_KEYS) {
    if (!Object.hasOwn(patch, key)) continue
    const config = LINE_FIELD_CONFIG[key]
    updates.push({ ...config, value: patch[key] })
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

/** Normalize one passive `useSystemValues` result into the row's value shape. */
export function lineValuesFromSystemValues(
  values: Record<string, unknown>,
  isQuote: boolean
): LineValues {
  return {
    name: (values.line_item_name as string | null | undefined) ?? '',
    description: (values.line_item_description as string | null | undefined) ?? null,
    category: (values.line_item_category as string | null | undefined) ?? null,
    taxable: (values.line_item_taxable as boolean | undefined) !== false,
    qty: (values.line_item_qty as number | null | undefined) ?? 1,
    unit: (values.line_item_unit as LineItemUnit | null | undefined) ?? null,
    unitPriceCents: (values.line_item_unit_price as number | null | undefined) ?? null,
    optional: isQuote && (values.line_item_optional as boolean | undefined) === true,
    optionalSelected:
      !isQuote || (values.line_item_optional_selected as boolean | undefined) !== false,
    catalogItemRecordId: null,
  }
}
