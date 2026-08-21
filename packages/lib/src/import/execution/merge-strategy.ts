// packages/lib/src/import/execution/merge-strategy.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { canonicalizeEntityDefinitionId, getCachedCustomFields } from '../../cache'
import { buildWriteKeyToFieldIdMap } from '../../field-values/write-key-map'
import type { ImportMergeStrategy } from '../../write-policy'
import { isImportMergeStrategy } from '../../write-policy'
import { parseResolutionConfig } from '../mapping/resolution-config'
import type { ImportMappingProperty } from '../types/mapping'

const logger = createScopedLogger('import-merge-strategy')

/**
 * Per-column merge policy, keyed the way `buildRecordData` keys the payload:
 * `customFieldId` for custom fields, `targetFieldKey` otherwise.
 */
export type MergeStrategyByKey = Map<string, ImportMergeStrategy>

/**
 * Read each mapped column's `resolutionConfig.mergeStrategy`.
 *
 * `resolutionConfig` is persisted as a JSON string; an unparseable or
 * unrecognised value falls back to `overwrite` (the documented default) rather
 * than failing the import, an unknown policy must never silently become
 * "don't write", which would look like a successful no-op import.
 *
 * Parsing goes through `parseResolutionConfig`, the one reader of that column,
 * which swallows a malformed blob into `{}`. That drops the old
 * "unparseable resolutionConfig" warn line; nothing else logged it, and the
 * outcome it announced (this column falls back to `overwrite`) is unchanged.
 * `mergeStrategy` is still guarded at runtime below, the config type is a claim
 * about a free-form column, not a validation of it.
 */
export function parseMergeStrategies(mappings: ImportMappingProperty[]): MergeStrategyByKey {
  const byKey: MergeStrategyByKey = new Map()

  for (const mapping of mappings) {
    if (!mapping.targetFieldKey || mapping.targetType === 'skip') continue
    if (!mapping.resolutionConfig) continue

    const candidate: unknown = parseResolutionConfig(mapping.resolutionConfig).mergeStrategy
    if (candidate === undefined || candidate === null) continue
    if (!isImportMergeStrategy(candidate)) {
      // `connector_owned_only` / `manual_review` have no import meaning; the
      // router validates on write, so reaching this is drift, not user input.
      logger.warn('Non-import merge strategy on a mapping column, ignored', {
        mappingPropertyId: mapping.id,
        candidate,
      })
      continue
    }

    byKey.set(mapping.customFieldId ?? mapping.targetFieldKey, candidate)
  }

  return byKey
}

/** Data keys carrying a given merge strategy. */
export function keysWithStrategy(
  byKey: MergeStrategyByKey,
  strategy: ImportMergeStrategy
): string[] {
  const keys: string[] = []
  for (const [key, value] of byKey) if (value === strategy) keys.push(key)
  return keys
}

/** True for null / undefined / empty-string / empty-array / whitespace values. */
export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * True when a stored FieldValue row actually carries something.
 *
 * Deliberately NOT `extractFieldValueScalar`, despite coalescing the same eight
 * columns in the same order. That helper unwraps the `{ v, meta }` envelope, so
 * a row holding ONLY `meta` reads as null there. `upsertGeneratingMarker`
 * inserts exactly that row, `valueJson = { meta: { ai } }` with every typed
 * column null, for a field whose AI generation is pending or failed. Reusing
 * the helper would call such a field blank and let `fill_blank` write over a
 * generation in flight. This question is "is anything stored at all", and it
 * fails safe toward withholding the write.
 */
function rowHasValue(row: {
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  valueJson: unknown
  optionId: string | null
  relatedEntityId: string | null
  actorId: string | null
}): boolean {
  if (row.valueText !== null && row.valueText.trim() !== '') return true
  if (row.valueNumber !== null) return true
  if (row.valueBoolean !== null) return true
  if (row.valueDate !== null) return true
  if (row.valueJson !== null && row.valueJson !== undefined) return true
  if (row.optionId !== null) return true
  if (row.relatedEntityId !== null) return true
  if (row.actorId !== null) return true
  return false
}

/**
 * For each instance, which of `dataKeys` already hold a NON-BLANK stored value.
 *
 * This is the `fill_blank` question, *"is the TARGET empty?"*, and it is a
 * different question from the blank-source rule (*"is the SOURCE cell
 * empty?"*). The two compose; they are not one switch.
 *
 * The key-space fix matters. Payload keys are `customFieldId ?? targetFieldKey`,
 * which for a system field is a `systemAttribute`, while `FieldValue.fieldId` is
 * always the `CustomField` uuid. A missed lookup would report the field as blank
 * and silently turn `fill_blank` into `overwrite`, so an unresolvable key is
 * reported as NON-blank (write withheld) and logged instead.
 *
 * Batched: one field-cache read and one query per execution batch, not per row.
 */
export async function loadNonBlankFieldKeys(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  instanceIds: string[],
  dataKeys: string[]
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  if (instanceIds.length === 0 || dataKeys.length === 0) return result

  // The `customFields` cache is keyed by EntityDefinition CUID, while
  // `ImportMapping.entityDefinitionId` may be the entityType slug (`part`). An
  // unresolved key returns NO fields, every payload key lands in `unresolved`,
  // and `fill_blank` then withholds every write it was asked to make.
  const defId = await canonicalizeEntityDefinitionId(organizationId, entityDefinitionId)
  const fields = await getCachedCustomFields(organizationId, defId)
  const keyToId = buildWriteKeyToFieldIdMap(fields)

  const fieldIdToKeys = new Map<string, string[]>()
  const unresolved: string[] = []
  for (const key of dataKeys) {
    const fieldId = keyToId.get(key)
    if (!fieldId) {
      unresolved.push(key)
      continue
    }
    const existing = fieldIdToKeys.get(fieldId)
    if (existing) existing.push(key)
    else fieldIdToKeys.set(fieldId, [key])
  }

  const markNonBlank = (instanceId: string, key: string) => {
    const set = result.get(instanceId) ?? new Set<string>()
    set.add(key)
    result.set(instanceId, set)
  }

  if (unresolved.length > 0) {
    logger.warn('fill_blank key has no resolvable CustomField, withholding the write', {
      entityDefinitionId: defId,
      unresolved,
    })
    for (const instanceId of instanceIds) {
      for (const key of unresolved) markNonBlank(instanceId, key)
    }
  }

  const fieldIds = [...fieldIdToKeys.keys()]
  if (fieldIds.length === 0) return result

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueBoolean: schema.FieldValue.valueBoolean,
      valueDate: schema.FieldValue.valueDate,
      valueJson: schema.FieldValue.valueJson,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      actorId: schema.FieldValue.actorId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, instanceIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  for (const row of rows) {
    if (!rowHasValue(row)) continue
    for (const key of fieldIdToKeys.get(row.fieldId) ?? []) {
      markNonBlank(row.entityId, key)
    }
  }

  return result
}
