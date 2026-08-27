// apps/web/src/components/resources/hooks/use-seed-created-record.ts

import type { FieldType } from '@auxx/database/types'
import {
  type FieldOptions,
  formatToTypedInput,
  isArrayReturnFieldType,
} from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useCallback } from 'react'
import {
  buildFieldValueKey,
  type FieldReference,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { type RecordMeta, useRecordStore } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { getNormalizedRecordId } from '~/components/resources/utils/normalize-record-id'
import { resolveSystemAttributeForRecord } from '~/components/resources/utils/resolve-system-attribute'

/** Minimal instance shape needed to seed a `RecordMeta` — the fields carried by
 *  `CreateEntityResult.instance` (`@auxx/lib` `unified-handler-mutations.ts`). */
export interface CreatedRecordInstance {
  id: string
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
  createdAt: string | Date
  updatedAt: string | Date
}

/** One field's value to seed into the field-value store, keyed by systemAttribute.
 *  `fieldType` is optional — system fields (`fieldType` undefined in the resource
 *  store) seed the raw value, matching `use-save-field-value.ts`'s guard. */
export interface SeedFieldValue {
  fieldId: string
  value: unknown
  fieldType?: FieldType
  /**
   * Field options (`options.multi`, `actor.multiple`, …). Without them a
   * multi-value scalar field (EMAIL/URL/PHONE with `options.multi`) seeds
   * through the scalar converter branch, which joins the array into ONE
   * comma string (`String(array)`) — the table cell then renders
   * "a@x.io,b@y.io" in a single chip until a full page reload.
   */
  fieldOptions?: FieldOptions
}

/**
 * Seed the record + field-value caches directly from a `record.create` result —
 * the phantom-draft-line replacement for the old `refresh()` round-trip (money
 * line-builder, MQ1 build spec §H.1). Mirrors the shapes
 * `use-record-batch-fetcher.ts` builds for `RecordMeta` and the
 * `resolveFieldRef` + `formatToTypedInput` pairing `use-save-field-value.ts`
 * uses for the field-value store, so the freshly-seeded row renders
 * identically to one hydrated from a list refetch — zero extra network calls.
 *
 * ⚠️ This seeds the new row's DATA only — it does not add it to any list.
 * List MEMBERSHIP is `useRecordList`'s `appendCreated`, which is the only place
 * that can reach both caches a list is served from (the record store AND the
 * tRPC query pages). Appending to just one of them makes the row revert on the
 * next remount, which is exactly what this hook used to do with its `listKey`.
 */
export function useSeedCreatedRecord() {
  const seedCreatedRecord = useCallback(
    (params: {
      entityDefinitionId: string
      recordId: RecordId
      instance: CreatedRecordInstance
      values: SeedFieldValue[]
    }) => {
      const { entityDefinitionId, instance, values } = params
      // Guard: canonicalize the prefix so seeded keys match subscriber keys.
      const recordId = getNormalizedRecordId(params.recordId)

      const meta: RecordMeta = {
        id: instance.id,
        recordId,
        displayName: instance.displayName ?? undefined,
        secondaryInfo: instance.secondaryDisplayValue ?? undefined,
        avatarUrl: instance.avatarUrl ?? undefined,
        createdAt:
          instance.createdAt instanceof Date
            ? instance.createdAt.toISOString()
            : instance.createdAt,
        updatedAt:
          instance.updatedAt instanceof Date
            ? instance.updatedAt.toISOString()
            : instance.updatedAt,
      }

      useRecordStore.getState().setRecords(entityDefinitionId, [meta])

      const resourceState = useResourceStore.getState()
      const entries = values.map(({ fieldId, value, fieldType, fieldOptions }) => {
        const resourceFieldId = (resolveSystemAttributeForRecord(
          resourceState,
          fieldId,
          recordId
        ) ?? fieldId) as FieldReference
        // Stable array shape for array-return fields (options.multi scalars,
        // multi ACTOR): normalize a scalar to a one-element array so the seeded
        // shape matches what `fieldValue.batchGet` delivers on refetch — cell
        // renderers branch on Array.isArray. `fieldOptions` also routes arrays
        // through the per-item converter instead of `String(array)`.
        const isArrayReturn = fieldType ? isArrayReturnFieldType(fieldType, fieldOptions) : false
        const normalized = isArrayReturn && value != null && !Array.isArray(value) ? [value] : value
        return {
          key: buildFieldValueKey(recordId, resourceFieldId),
          value: fieldType
            ? formatToTypedInput(normalized, fieldType, { fieldOptions })
            : normalized,
        }
      })
      useFieldValueStore.getState().setValues(entries)
    },
    []
  )

  return { seedCreatedRecord }
}
