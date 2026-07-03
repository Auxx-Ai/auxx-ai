// apps/web/src/components/resources/store/calc-value-computer.ts

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { formatToRawValue, formatToTypedInput } from '@auxx/lib/field-values/client'
import {
  getFieldId,
  isResourceFieldId,
  parseResourceFieldId,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { evaluateCalcExpression } from '@auxx/utils/calc-expression'
import { computedFieldRegistry } from './computed-field-registry'
import {
  buildFieldValueKey,
  type FieldValueKey,
  parseFieldValueKey,
  parseRecordId,
  type RecordId,
  type StoredFieldValue,
  useFieldValueStore,
} from './field-value-store'

/**
 * Wrap a computed value in TypedFieldValue format using existing formatter.
 */
function wrapCalcValue(value: unknown, resultType: string): StoredFieldValue {
  // Use existing formatToTypedInput which handles all field types correctly
  return formatToTypedInput(value, resultType as FieldType)
}

/**
 * Compute a single CALC field for one record from the given value maps.
 * Returns `undefined` while any source value is missing (still loading) so
 * callers can defer instead of rendering a wrong value. Recurses into
 * CALC-typed sources; `processed` guards against cycles.
 */
function computeCalcFieldValue(
  recordId: RecordId,
  calcFieldId: ResourceFieldId,
  currentValues: Record<FieldValueKey, StoredFieldValue>,
  newCalcValues: Record<FieldValueKey, StoredFieldValue>,
  processed: Set<string>
): StoredFieldValue | undefined {
  const calcKey = buildFieldValueKey(recordId, calcFieldId)

  // Avoid circular computation
  if (processed.has(calcKey)) {
    return newCalcValues[calcKey] ?? currentValues[calcKey]
  }
  processed.add(calcKey)

  const config = computedFieldRegistry.getConfig(calcFieldId)
  if (!config) return undefined

  if (config.disabled) {
    return wrapCalcValue(null, config.resultFieldType)
  }

  const { entityDefinitionId } = parseRecordId(recordId)

  // Gather source values (pass TypedFieldValue directly - evaluateCalcExpression handles extraction)
  const sourceValues: Record<string, unknown> = {}
  let hasMissing = false

  for (const [placeholder, sourceFieldId] of Object.entries(config.sourceFields)) {
    // sourceFields store plain field UUIDs; the registry is keyed by ResourceFieldId
    const sourceResourceFieldId = isResourceFieldId(sourceFieldId)
      ? (sourceFieldId as ResourceFieldId)
      : toResourceFieldId(entityDefinitionId, sourceFieldId)

    // Check if source is also a CALC field that needs computing first
    if (computedFieldRegistry.isComputed(sourceResourceFieldId)) {
      const computed = computeCalcFieldValue(
        recordId,
        sourceResourceFieldId,
        currentValues,
        newCalcValues,
        processed
      )
      if (computed === undefined) hasMissing = true
      sourceValues[placeholder] = computed // evaluateCalcExpression handles extraction
    } else {
      const sourceKey = buildFieldValueKey(recordId, sourceFieldId)
      const stored = newCalcValues[sourceKey] ?? currentValues[sourceKey]
      if (stored === undefined) hasMissing = true
      sourceValues[placeholder] = stored // evaluateCalcExpression handles extraction
    }
  }

  // If any source is missing, report undefined (still loading)
  if (hasMissing) {
    return undefined
  }

  // Handle NAME fields (no expression, just combine firstName + lastName)
  if (config.resultFieldType === FieldTypeEnum.NAME || !config.expression) {
    const firstName = String(formatToRawValue(sourceValues['firstName'], 'TEXT') ?? '')
    const lastName = String(formatToRawValue(sourceValues['lastName'], 'TEXT') ?? '')
    return wrapCalcValue({ firstName: firstName ?? '', lastName: lastName ?? '' }, 'NAME')
  }

  // Evaluate expression for CALC fields
  try {
    const result = evaluateCalcExpression(config.expression, sourceValues)
    return wrapCalcValue(result, config.resultFieldType)
  } catch (error) {
    console.error(`Error computing CALC field ${calcFieldId}:`, error)
    return wrapCalcValue(null, config.resultFieldType)
  }
}

/**
 * Compute CALC values for all fields that depend on the changed keys.
 * Returns a map of calcFieldKey -> computedValue to be merged into state.values.
 *
 * Handles CALC fields depending on other CALC fields via recursive computation.
 */
export function computeDependentCalcValues(
  changedKeys: FieldValueKey[],
  currentValues: Record<FieldValueKey, StoredFieldValue>
): Record<FieldValueKey, StoredFieldValue> {
  const newCalcValues: Record<FieldValueKey, StoredFieldValue> = {}
  const processed = new Set<string>()

  // Collect all recordIds affected
  const affectedRecords = new Map<string, Set<string>>() // recordId -> Set<sourceFieldId>

  for (const changedKey of changedKeys) {
    const { recordId, fieldRef } = parseFieldValueKey(changedKey)
    const fieldRefStr = typeof fieldRef === 'string' ? fieldRef : fieldRef[fieldRef.length - 1]
    // Extract plain FieldId (UUID) from ResourceFieldId for dependency graph lookup.
    // The dependency graph stores plain UUIDs as keys (from sourceFields config),
    // but parseFieldValueKey returns ResourceFieldId format ("entityDef:fieldId").
    const fieldId =
      typeof fieldRefStr === 'string' && isResourceFieldId(fieldRefStr)
        ? getFieldId(fieldRefStr as ResourceFieldId)
        : fieldRefStr

    if (!affectedRecords.has(recordId)) {
      affectedRecords.set(recordId, new Set())
    }
    affectedRecords.get(recordId)!.add(fieldId)
  }

  // For each affected record, compute dependent CALC values
  for (const [recordId, changedFieldIds] of affectedRecords) {
    const calcFieldsToCompute = new Set<ResourceFieldId>()

    // Find all CALC fields that depend on any changed field
    for (const fieldId of changedFieldIds) {
      const dependents = computedFieldRegistry.getDependentFields(fieldId)
      for (const calcFieldId of dependents) {
        calcFieldsToCompute.add(calcFieldId)
      }
    }

    // Compute all affected CALC fields
    for (const calcFieldId of calcFieldsToCompute) {
      const calcKey = buildFieldValueKey(recordId as RecordId, calcFieldId)
      const computed = computeCalcFieldValue(
        recordId as RecordId,
        calcFieldId,
        currentValues,
        newCalcValues,
        processed
      )
      if (computed !== undefined) {
        newCalcValues[calcKey] = computed
      }
    }
  }

  return newCalcValues
}

/**
 * Compute one CALC field for one record from current store state and write it.
 * Covers the triggers that never come from a source-value arrival: zero-source
 * (literal-only) formulas and the all-sources-already-cached fetch path. No-op
 * while any source value is missing/in-flight (a later `setValues` will
 * trigger the normal dependent recompute) or while the key has a pending
 * optimistic update.
 */
export function ensureCalcValue(recordId: RecordId, calcFieldId: ResourceFieldId): void {
  const store = useFieldValueStore.getState()
  const computed = computeCalcFieldValue(recordId, calcFieldId, store.values, {}, new Set())
  if (computed === undefined) return

  const calcKey = buildFieldValueKey(recordId, calcFieldId)
  if (store.pendingUpdates[calcKey]) return
  store.setValue(calcKey, computed)
}

/**
 * Recompute a CALC field for every record of its entity definition that has
 * values loaded in the store. Called when a calc config registers with a new
 * or changed definition (expression edit, optimistic field update, or the
 * registry losing the race against the initial value fetch) so stale computed
 * values refresh without a page reload.
 */
export function recomputeCalcField(calcFieldId: ResourceFieldId): void {
  const { entityDefinitionId } = parseResourceFieldId(calcFieldId)
  const store = useFieldValueStore.getState()

  // Store keys are `${entityDefId}:${entityInstId}:${fieldRefKey}` — prefix
  // scan finds every record of this definition with anything loaded.
  const prefix = `${entityDefinitionId}:`
  const recordIds = new Set<RecordId>()
  for (const key of Object.keys(store.values)) {
    if (!key.startsWith(prefix)) continue
    recordIds.add(parseFieldValueKey(key as FieldValueKey).recordId)
  }
  if (recordIds.size === 0) return

  const entries: Array<{ key: FieldValueKey; value: StoredFieldValue }> = []
  for (const recordId of recordIds) {
    const computed = computeCalcFieldValue(recordId, calcFieldId, store.values, {}, new Set())
    if (computed === undefined) continue
    entries.push({ key: buildFieldValueKey(recordId, calcFieldId), value: computed })
  }
  if (entries.length > 0) {
    // setValues skips keys with pending optimistic updates and cascades to
    // dependent CALC fields.
    useFieldValueStore.getState().setValues(entries)
  }
}
