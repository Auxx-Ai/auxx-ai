// apps/web/src/components/resources/store/calc-value-computer.ts

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { formatToRawValue, formatToTypedInput } from '@auxx/lib/field-values/client'
import { getFieldId, isResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { evaluateCalcExpression } from '@auxx/utils/calc-expression'
import { computedFieldRegistry } from './computed-field-registry'
import {
  buildFieldValueKey,
  type FieldValueKey,
  parseFieldValueKey,
  type StoredFieldValue,
} from './field-value-store'

/**
 * Wrap a computed value in TypedFieldValue format using existing formatter.
 */
function wrapCalcValue(value: unknown, resultType: string): StoredFieldValue {
  // Use existing formatToTypedInput which handles all field types correctly
  return formatToTypedInput(value, resultType as FieldType)
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
    const calcFieldsToCompute = new Set<string>()

    // Find all CALC fields that depend on any changed field
    for (const fieldId of changedFieldIds) {
      const dependents = computedFieldRegistry.getDependentFields(fieldId)
      for (const calcFieldId of dependents) {
        calcFieldsToCompute.add(calcFieldId)
      }
    }

    // Compute each CALC field (handles cascading dependencies)
    const computeCalcField = (calcFieldId: string): StoredFieldValue | undefined => {
      const calcKey = buildFieldValueKey(recordId as any, calcFieldId)

      // Avoid circular computation
      if (processed.has(calcKey)) {
        return newCalcValues[calcKey] ?? currentValues[calcKey]
      }
      processed.add(calcKey)

      const config = computedFieldRegistry.getConfig(calcFieldId as any)
      if (!config) return undefined

      if (config.disabled) {
        return wrapCalcValue(null, config.resultFieldType)
      }

      // Gather source values (pass TypedFieldValue directly - evaluateCalcExpression handles extraction)
      const sourceValues: Record<string, unknown> = {}
      let hasMissing = false

      for (const [placeholder, sourceFieldId] of Object.entries(config.sourceFields)) {
        const sourceKey = buildFieldValueKey(recordId as any, sourceFieldId)

        // Check if source is also a CALC field that needs computing first
        if (computedFieldRegistry.isComputed(sourceFieldId as any)) {
          const computed = computeCalcField(sourceFieldId)
          sourceValues[placeholder] = computed // evaluateCalcExpression handles extraction
        } else {
          const stored = newCalcValues[sourceKey] ?? currentValues[sourceKey]
          if (stored === undefined) hasMissing = true
          sourceValues[placeholder] = stored // evaluateCalcExpression handles extraction
        }
      }

      // If any source is missing, store undefined (still loading)
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

    // Compute all affected CALC fields
    for (const calcFieldId of calcFieldsToCompute) {
      const calcKey = buildFieldValueKey(recordId as any, calcFieldId)
      const computed = computeCalcField(calcFieldId)
      if (computed !== undefined) {
        newCalcValues[calcKey] = computed
      }
    }
  }

  return newCalcValues
}
