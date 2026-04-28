// packages/lib/src/field-values/calc-resolver.ts

import type { FieldType } from '@auxx/database/types'
import { parseResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { evaluateCalcExpression } from '@auxx/utils/calc-expression'
import { getCalcOptions, getEffectiveFieldType } from '../custom-fields/calc'
import { type FieldValueContext, getField } from './field-value-helpers'
import { batchGetValues } from './field-value-queries'
import { formatToDisplayValue, formatToTypedInput } from './formatter'

/** Hard cap on CALC → CALC recursion depth. */
const MAX_CALC_DEPTH = 5

export interface CalcResolution {
  /** Computed raw value (number/string/boolean/null), already type-coerced. */
  value: unknown
  /** Stringified display value, formatted via the result field's converter. */
  display: string
  /** The CALC's resultFieldType (or null when the field is misconfigured). */
  resultFieldType: FieldType | null
}

/**
 * Compute a CALC field's value for a single record. Mirrors the client's
 * `calc-value-computer.ts` algorithm but resolves source values from the
 * database instead of a Zustand store. CALC sources that are themselves
 * CALC are handled recursively, with a depth guard.
 *
 * Returns `{ value: null, display: '', resultFieldType: null }` for
 * disabled / misconfigured / unresolvable cases — never throws on bad
 * input. Throws only on infrastructure errors (DB, missing field).
 *
 * Reusable: every server-side path that needs a CALC value for a record
 * (AI prompt resolution, timeline snapshot, MCP tools, webhooks) calls
 * this. Do not roll a parallel implementation.
 */
export async function resolveCalcForRecord(
  ctx: FieldValueContext,
  params: { recordId: RecordId; calcFieldId: string },
  depth = 0
): Promise<CalcResolution> {
  if (depth > MAX_CALC_DEPTH) {
    return { value: null, display: '', resultFieldType: null }
  }

  const field = await getField(ctx, params.calcFieldId)
  if (field.type !== 'CALC') {
    return { value: null, display: '', resultFieldType: null }
  }

  const calc = getCalcOptions(field)
  if (!calc || calc.disabled || !calc.expression) {
    return {
      value: null,
      display: '',
      resultFieldType: (calc?.resultFieldType as FieldType | undefined) ?? null,
    }
  }

  const { entityDefinitionId } = parseRecordId(params.recordId)

  const sourceEntries = Object.entries(calc.sourceFields)
  const refs = sourceEntries.map(([, fieldId]) => toResourceFieldId(entityDefinitionId, fieldId))

  const { values } = await batchGetValues(ctx, {
    recordIds: [params.recordId],
    fieldReferences: refs,
  })

  // Index by terminal fieldId via parseResourceFieldId — no manual splits.
  const byFieldId = new Map<string, (typeof values)[number]>()
  for (const v of values) {
    const tail = Array.isArray(v.fieldRef) ? v.fieldRef[v.fieldRef.length - 1]! : v.fieldRef
    const { fieldId } = parseResourceFieldId(tail)
    byFieldId.set(fieldId, v)
  }

  const sourceValues: Record<string, unknown> = {}
  for (const [placeholder, fieldId] of sourceEntries) {
    const hit = byFieldId.get(fieldId)
    if (hit?.fieldType === 'CALC') {
      const nested = await resolveCalcForRecord(
        ctx,
        { recordId: params.recordId, calcFieldId: fieldId },
        depth + 1
      )
      sourceValues[placeholder] = nested.value
    } else {
      // evaluateCalcExpression handles TypedFieldValue extraction internally.
      sourceValues[placeholder] = hit?.value ?? null
    }
  }

  const computed = evaluateCalcExpression(calc.expression, sourceValues)
  const resultFieldType = getEffectiveFieldType(field)

  // Round-trip through the canonical converter pipeline:
  //   raw  ──formatToTypedInput──►  TypedFieldValue  ──formatToDisplayValue──►  string
  // This is the same path the client's `calc-value-computer.ts` uses to
  // wrap CALC outputs (`wrapCalcValue` → `formatToTypedInput`). Going
  // through the converters means future converter changes (e.g. a new
  // currency format option) flow into CALC display automatically.
  const typed = formatToTypedInput(computed, resultFieldType)
  const formatted = typed
    ? formatToDisplayValue(typed as never, resultFieldType, (field.options ?? undefined) as never)
    : null
  const display =
    formatted === null || formatted === undefined
      ? ''
      : Array.isArray(formatted)
        ? formatted.filter((v) => v !== null && v !== undefined).join(', ')
        : String(formatted)

  return { value: computed, display, resultFieldType }
}
