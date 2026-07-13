// apps/web/src/components/money/hooks/use-seed-catalog-record.ts

import type { FieldType } from '@auxx/database/types'
import { formatToTypedInput } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useCallback } from 'react'
import type {
  CreatedRecordInstance,
  SeedFieldValue,
} from '~/components/resources/hooks/use-seed-created-record'
import {
  buildFieldValueKey,
  type FieldReference,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { type RecordMeta, useRecordStore } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'

/**
 * Seed the record + field-value caches from a `record.create` result for the
 * catalog settings surfaces (products, groups) — same store-write shape as
 * `useSeedCreatedRecord` (`resources/hooks/use-seed-created-record.ts`), minus
 * the record-store LIST-cache push (`appendCreatedRecord(listKey)`): these
 * lists come from `useAllRecords`'s `listAll` query cache, which is pushed
 * separately via `appendRecord` from `useCatalogItems`/`useCatalogGroups`, so
 * there's no `listKey` to thread through here. Nulls are included in `values`
 * so nothing flashes as blank/undefined before the diff-flush lands.
 */
export function useSeedCatalogRecord() {
  const seedCatalogRecord = useCallback(
    (params: {
      entityDefinitionId: string
      recordId: RecordId
      instance: CreatedRecordInstance
      values: SeedFieldValue[]
    }) => {
      const { entityDefinitionId, recordId, instance, values } = params

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

      const systemAttributeMap = useResourceStore.getState().systemAttributeMap
      const entries = values.map(({ fieldId, value, fieldType }) => {
        const resourceFieldId = (systemAttributeMap[fieldId] ?? fieldId) as FieldReference
        return {
          key: buildFieldValueKey(recordId, resourceFieldId),
          value: formatToTypedInput(value, fieldType as FieldType),
        }
      })
      useFieldValueStore.getState().setValues(entries)
    },
    []
  )

  return { seedCatalogRecord }
}
