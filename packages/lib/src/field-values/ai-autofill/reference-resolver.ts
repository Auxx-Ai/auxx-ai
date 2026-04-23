// packages/lib/src/field-values/ai-autofill/reference-resolver.ts

import type { FieldType } from '@auxx/database/types'
import type { FieldPath, FieldReference, ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { isAiField } from '../../custom-fields/ai'
import { BadRequestError } from '../../errors'
import type { FieldValueContext } from '../field-value-helpers'
import { getField } from '../field-value-helpers'
import * as queries from '../field-value-queries'
import { formatToDisplayValue } from '../formatter'

/**
 * One `{fieldKey}` resolved to its display string, ready to substitute
 * into the prompt.
 */
export interface ResolvedReference {
  /** Raw badge id as it appeared in the prompt (e.g. "email", "company.industry") */
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
 * Each key is one of:
 *   - Plain fieldId (custom UUID or system field key) → sibling/system field
 *   - Dotted `"relFieldId.terminalFieldId"` → one-hop relationship traversal
 *
 * Returns a `Map<fieldKey, ResolvedReference>` that the prompt builder then
 * interpolates into the user message.
 *
 * Blank / null / unresolvable references pass through as empty string
 * (decision T4.3). Truly malformed prompts (malformed dotted refs, refs
 * pointing at other AI-enabled fields) throw `BadRequestError`.
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
  const refs: Array<{ fieldKey: string; ref: FieldReference | null; terminalFieldId: string }> = []

  for (const fieldKey of fieldKeys) {
    if (fieldKey.includes('.')) {
      const parts = fieldKey.split('.')
      if (parts.length !== 2) {
        throw new BadRequestError(
          `Unsupported reference "{${fieldKey}}": only one-hop relationships are allowed in v1`
        )
      }
      const [relFieldId, terminalFieldId] = parts
      if (!relFieldId || !terminalFieldId) {
        throw new BadRequestError(`Malformed reference "{${fieldKey}}"`)
      }

      const relatedEntityDefinitionId = await resolveRelatedEntityDefinitionId(ctx, relFieldId)
      if (!relatedEntityDefinitionId) {
        // Relation field not found or not configured — leave unresolved; becomes ''.
        refs.push({ fieldKey, ref: null, terminalFieldId })
        continue
      }

      const path: FieldPath = [
        toResourceFieldId(entityDefinitionId, relFieldId),
        toResourceFieldId(relatedEntityDefinitionId, terminalFieldId),
      ]
      refs.push({ fieldKey, ref: path, terminalFieldId })
    } else {
      if (!fieldKey.trim()) {
        refs.push({ fieldKey, ref: null, terminalFieldId: fieldKey })
        continue
      }
      refs.push({
        fieldKey,
        ref: toResourceFieldId(entityDefinitionId, fieldKey),
        terminalFieldId: fieldKey,
      })
    }
  }

  // Runtime AI-to-AI guard (decision T4.2). Save-time validation in phase 04
  // is the primary gate; this is a belt-and-braces check for stale prompts.
  for (const { fieldKey, terminalFieldId } of refs) {
    await assertTerminalIsNotAiField(ctx, fieldKey, terminalFieldId)
  }

  const fieldReferences = refs
    .map((r) => r.ref)
    .filter((ref): ref is FieldReference => ref !== null)

  if (fieldReferences.length === 0) {
    // All refs unresolvable — emit empty entries for each key.
    for (const { fieldKey } of refs) {
      out.set(fieldKey, { fieldKey, displayValue: '', fieldType: null, resourceFieldId: null })
    }
    return out
  }

  const { values } = await queries.batchGetValues(ctx, {
    recordIds: [recordId],
    fieldReferences,
  })

  // Index results by serialized fieldRef for lookup.
  const resultIndex = new Map<string, (typeof values)[number]>()
  for (const v of values) {
    resultIndex.set(serializeFieldRef(v.fieldRef), v)
  }

  for (const { fieldKey, ref } of refs) {
    if (ref === null) {
      out.set(fieldKey, { fieldKey, displayValue: '', fieldType: null, resourceFieldId: null })
      continue
    }

    const hit = resultIndex.get(serializeFieldRef(ref))
    if (!hit) {
      out.set(fieldKey, { fieldKey, displayValue: '', fieldType: null, resourceFieldId: null })
      continue
    }

    const displayRaw = formatToDisplayValue(hit.value, hit.fieldType, hit.fieldOptions)
    const displayValue =
      displayRaw === null || displayRaw === undefined
        ? ''
        : typeof displayRaw === 'string'
          ? displayRaw
          : Array.isArray(displayRaw)
            ? displayRaw.filter((v) => v !== null && v !== undefined).join(', ')
            : JSON.stringify(displayRaw)

    out.set(fieldKey, {
      fieldKey,
      displayValue,
      fieldType: hit.fieldType,
      resourceFieldId: terminalResourceFieldId(ref),
    })
  }

  return out
}

/**
 * Look up the related entity's entityDefinitionId for a relationship field.
 * Returns null when the field is missing, not a RELATIONSHIP, or has no
 * inverse configured.
 */
async function resolveRelatedEntityDefinitionId(
  ctx: FieldValueContext,
  relFieldId: string
): Promise<string | null> {
  try {
    const field = await getField(ctx, relFieldId)
    if (field.type !== 'RELATIONSHIP') return null
    const relationship = (field.options as Record<string, unknown> | null)?.relationship as
      | { inverseResourceFieldId?: string | null }
      | undefined
    const inverse = relationship?.inverseResourceFieldId
    if (!inverse) return null
    // `inverseResourceFieldId` format: "<relatedEntityDefinitionId>:<fieldId>"
    const idx = inverse.indexOf(':')
    return idx === -1 ? inverse : inverse.slice(0, idx)
  } catch {
    return null
  }
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

function serializeFieldRef(ref: FieldReference): string {
  return Array.isArray(ref) ? ref.join('->') : String(ref)
}

function terminalResourceFieldId(ref: FieldReference): ResourceFieldId | null {
  if (Array.isArray(ref)) {
    return (ref[ref.length - 1] ?? null) as ResourceFieldId | null
  }
  if (typeof ref === 'string' && ref.includes(':')) return ref as ResourceFieldId
  return null
}
