// apps/web/src/components/resources/hooks/use-seed-created-record.ts

import type { FieldType } from '@auxx/database/types'
import { formatToTypedInput } from '@auxx/lib/field-values/client'
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

/** One field's value to seed into the field-value store, keyed by systemAttribute. */
export interface SeedFieldValue {
  fieldId: string
  value: unknown
  fieldType: FieldType
}

/**
 * Seed the record + field-value caches directly from a `record.create` result —
 * the phantom-draft-line replacement for the old `refresh()` round-trip (money
 * line-builder, MQ1 build spec §H.1). Mirrors the shapes
 * `use-record-batch-fetcher.ts` builds for `RecordMeta` and the
 * `resolveFieldRef` + `formatToTypedInput` pairing `use-save-field-value.ts`
 * uses for the field-value store, so the freshly-seeded row renders
 * identically to one hydrated from a list refetch — zero extra network calls.
 */
export function useSeedCreatedRecord() {
  const seedCreatedRecord = useCallback(
    (params: {
      entityDefinitionId: string
      recordId: RecordId
      listKey: string
      instance: CreatedRecordInstance
      values: SeedFieldValue[]
    }) => {
      const { entityDefinitionId, listKey, instance, values } = params
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

      const recordStore = useRecordStore.getState()
      recordStore.setRecords(entityDefinitionId, [meta])
      recordStore.appendCreatedRecord(listKey, instance.id)

      const systemAttributeMap = useResourceStore.getState().systemAttributeMap
      const entries = values.map(({ fieldId, value, fieldType }) => {
        const resourceFieldId = (systemAttributeMap[fieldId] ?? fieldId) as FieldReference
        return {
          key: buildFieldValueKey(recordId, resourceFieldId),
          value: formatToTypedInput(value, fieldType),
        }
      })
      useFieldValueStore.getState().setValues(entries)
    },
    []
  )

  return { seedCreatedRecord }
}
