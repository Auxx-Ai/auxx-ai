// packages/lib/src/field-values/ai-autofill/reference-resolver.ts

import type { FieldType } from '@auxx/database/types'
import {
  type FieldPath,
  fieldRefToKey,
  getFieldId,
  isFieldPath,
  isPlainFieldId,
  isResourceFieldId,
  keyToFieldRef,
  type ResourceFieldId,
  toFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { isRecordId, parseRecordId, type RecordId } from '@auxx/types/resource'
import { isAiField } from '../../custom-fields/ai'
import { BadRequestError } from '../../errors'
import { resolveCalcForRecord } from '../calc-resolver'
import {
  batchGetRelatedDisplayNames,
  type FieldValueContext,
  getField,
} from '../field-value-helpers'
import * as queries from '../field-value-queries'
import { formatToDisplayValue } from '../formatter'

/**
 * One `{fieldKey}` resolved to its display string, ready to substitute
 * into the prompt.
 */
export interface ResolvedReference {
  /** Raw badge id as it appeared in the prompt. */
  fieldKey: string
  /** Stringified display value (e.g. "Apr 22, 2026", "Manufacturing", ""). */
  displayValue: string
  /** Terminal field's type — used for debug and stale-hash stability. */
  fieldType: FieldType | null
  /** Canonical terminal id for the resolved ref (null when unresolvable). */
  resourceFieldId: ResourceFieldId | null
}

/**
 * Resolve every `{fieldKey}` token in a prompt for a given record.
 *
 * Each key is one of (decoded via `keyToFieldRef` / `isPlainFieldId`):
 *   - Plain `FieldId` (no `:`)             → scoped to record's entity
 *   - `ResourceFieldId` (`"entity:fieldId"`) → direct field
 *   - FieldPath key (`"a:b::c:d"` ...)     → multi-hop traversal
 *
 * Returns a `Map<fieldKey, ResolvedReference>` that the prompt builder then
 * interpolates into the user message.
 *
 * Blank / null / unresolvable references pass through as empty string
 * (decision T4.3). Refs pointing at other AI-enabled fields throw
 * `BadRequestError` (decision T4.2). Path depth is capped by
 * `validateFieldReferences` (`MAX_PATH_DEPTH = 5`) inside
 * `batchGetValues`.
 */
export async function resolveReferences(
  ctx: FieldValueContext,
  params: {
    recordId: RecordId
    fieldKeys: string[]
  }
): Promise<Map<string, ResolvedReference>> {
  const { recordId, fieldKeys } = params
  const out = new Map<string, ResolvedReference>()
  if (fieldKeys.length === 0) return out

  const { entityDefinitionId } = parseRecordId(recordId)

  // Build one FieldReference per fieldKey, kept aligned with `fieldKeys` by
  // index so the batchGetValues result can be mapped back.
  const refs: Array<{
    fieldKey: string
    ref: ResourceFieldId | FieldPath | null
    terminalFieldId: string
  }> = []

  for (const fieldKey of fieldKeys) {
    if (!fieldKey.trim()) {
      refs.push({ fieldKey, ref: null, terminalFieldId: fieldKey })
      continue
    }

    // Plain FieldId (no colon) → scope to the record's entity.
    // Anything else → keyToFieldRef discriminates ResourceFieldId vs FieldPath.
    const ref: ResourceFieldId | FieldPath = isPlainFieldId(fieldKey)
      ? toResourceFieldId(entityDefinitionId, toFieldId(fieldKey))
      : (keyToFieldRef(fieldKey) as ResourceFieldId | FieldPath)

    // Terminal id (last hop) — used by the AI-to-AI guard below.
    const terminalRfId = isFieldPath(ref) ? ref[ref.length - 1]! : ref
    const terminalFieldId = getFieldId(terminalRfId)

    refs.push({ fieldKey, ref, terminalFieldId })
  }

  // Runtime AI-to-AI guard (decision T4.2). Save-time validation in phase 04
  // is the primary gate; this is a belt-and-braces check for stale prompts.
  for (const { fieldKey, terminalFieldId } of refs) {
    await assertTerminalIsNotAiField(ctx, fieldKey, terminalFieldId)
  }

  const fieldReferences = refs
    .map((r) => r.ref)
    .filter((ref): ref is ResourceFieldId | FieldPath => ref !== null)

  if (fieldReferences.length === 0) {
    for (const { fieldKey } of refs) {
      out.set(fieldKey, { fieldKey, displayValue: '', fieldType: null, resourceFieldId: null })
    }
    return out
  }

  const { values } = await queries.batchGetValues(ctx, {
    recordIds: [recordId],
    fieldReferences,
  })

  // Index results by fieldRef key for lookup.
  const resultIndex = new Map<string, (typeof values)[number]>()
  for (const v of values) {
    resultIndex.set(fieldRefToKey(v.fieldRef), v)
  }

  for (const { fieldKey, ref } of refs) {
    if (ref === null) {
      out.set(fieldKey, { fieldKey, displayValue: '', fieldType: null, resourceFieldId: null })
      continue
    }

    const hit = resultIndex.get(fieldRefToKey(ref))
    if (!hit) {
      out.set(fieldKey, { fieldKey, displayValue: '', fieldType: null, resourceFieldId: null })
      continue
    }

    const displayRaw = formatToDisplayValue(hit.value, hit.fieldType, hit.fieldOptions)
    const displayValue = stringifyDisplay(displayRaw)

    out.set(fieldKey, {
      fieldKey,
      displayValue,
      fieldType: hit.fieldType,
      resourceFieldId: terminalResourceFieldId(ref),
    })
  }

  // Post-process CALC terminals: substitute the computed display value.
  for (const [fieldKey, resolved] of out) {
    if (resolved.fieldType !== 'CALC' || !resolved.resourceFieldId) continue
    const calcFieldId = getFieldId(resolved.resourceFieldId)
    const calc = await resolveCalcForRecord(ctx, { recordId, calcFieldId })
    out.set(fieldKey, {
      ...resolved,
      displayValue: calc.display,
      fieldType: calc.resultFieldType ?? resolved.fieldType,
    })
  }

  // Post-process RELATIONSHIP terminals: swap RecordId(s) → displayName(s).
  const relMap = new Map<string, RecordId[]>()
  const allRelIds: RecordId[] = []
  for (const [fieldKey, resolved] of out) {
    if (resolved.fieldType !== 'RELATIONSHIP') continue
    const ids = resolved.displayValue
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is RecordId => isRecordId(s))
    relMap.set(fieldKey, ids)
    allRelIds.push(...ids)
  }

  if (allRelIds.length > 0) {
    const names = await batchGetRelatedDisplayNames(ctx.db, ctx.organizationId, allRelIds)
    for (const [fieldKey, ids] of relMap) {
      const display = ids
        .map((rid) => names.get(parseRecordId(rid).entityInstanceId) ?? '')
        .filter(Boolean)
        .join(', ')
      const prev = out.get(fieldKey)!
      out.set(fieldKey, { ...prev, displayValue: display })
    }
  }

  return out
}

async function assertTerminalIsNotAiField(
  ctx: FieldValueContext,
  fieldKey: string,
  terminalFieldId: string
): Promise<void> {
  try {
    const field = await getField(ctx, terminalFieldId)
    if (isAiField(field)) {
      throw new BadRequestError(
        `Reference "{${fieldKey}}" points at another AI-enabled field — AI-to-AI chains are not allowed`
      )
    }
  } catch (err) {
    // Rethrow the AI-to-AI guard; swallow "field not found" (system fields).
    if (err instanceof BadRequestError) throw err
  }
}

function stringifyDisplay(displayRaw: unknown): string {
  if (displayRaw === null || displayRaw === undefined) return ''
  if (typeof displayRaw === 'string') return displayRaw
  if (Array.isArray(displayRaw)) {
    return displayRaw.filter((v) => v !== null && v !== undefined).join(', ')
  }
  return JSON.stringify(displayRaw)
}

function terminalResourceFieldId(ref: ResourceFieldId | FieldPath): ResourceFieldId | null {
  if (isFieldPath(ref)) {
    return (ref[ref.length - 1] ?? null) as ResourceFieldId | null
  }
  return isResourceFieldId(ref) ? ref : null
}
