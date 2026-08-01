// apps/web/src/components/apps/host/data-handlers/record-data-handler.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { extractValues } from '@auxx/lib/field-values/client'
import { getFieldOutputKey, parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { type FieldReference, fieldRefToKey } from '@auxx/types/field'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { useEffect } from 'react'
import { useAppDataHandlerContext } from '~/components/apps/providers/app-data-handler-context'
import {
  buildFieldValueKey,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { getRecordStoreState } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { getNormalizedRecordId } from '~/components/resources/utils/normalize-record-id'
import { api } from '~/trpc/react'

/**
 * Serializable record returned to an app's `useRecord(recordId)` hook.
 * `data` is keyed by each field's stable attribute key (its `systemAttribute`,
 * e.g. `primary_email`, `phone`) and carries plain unwrapped values (scalar for
 * single-value fields, array for multi-value fields).
 */
interface AppRecord {
  id: string
  type: string
  displayName?: string
  data: Record<string, unknown>
  createdAt?: string | Date
  updatedAt?: string | Date
}

/** Unwrap a typed field value to a plain JS value for the app. */
function unwrapValue(
  value: TypedFieldValue | TypedFieldValue[] | null,
  fieldType: FieldType
): unknown {
  const raws = extractValues(value, fieldType)
  return raws.length <= 1 ? (raws[0] ?? null) : raws
}

/**
 * Serves an app's `get-record` requests (the `useRecord` SDK hook). Reads
 * through the two client stores the detail view already hydrates — record
 * metadata + the field-value store — and falls back to the authoritative
 * `fieldValue.batchGet` for any field not yet in the store, so `useRecord`
 * is correct from any surface, not just a warm detail view.
 *
 * Returns every field on the record, attribute-keyed, so an app reads whatever
 * it declares interest in (e.g. the Stripe link dialog reads `data.primary_email`).
 */
export function RecordDataHandler() {
  const { messageClient } = useAppDataHandlerContext()
  const getResourceById = useResourceStore((s) => s.getResourceById)
  const batchGetAsync = api.fieldValue.batchGet.useMutation().mutateAsync

  useEffect(() => {
    const unsubscribe = messageClient.listenForRequest(
      'get-record',
      async ({ recordId }: { recordId: string }): Promise<AppRecord> => {
        const normalized = getNormalizedRecordId(recordId as RecordId)
        const { entityDefinitionId, entityInstanceId } = parseRecordId(normalized)

        const resource = getResourceById(entityDefinitionId)
        if (!resource) throw new Error(`Unknown resource for record ${recordId}`)

        const meta = getRecordStoreState().records[entityDefinitionId]?.get(entityInstanceId)
        const stored = useFieldValueStore.getState().values

        const data: Record<string, unknown> = {}
        const missing: FieldReference[] = []
        const refToField = new Map<string, (typeof resource.fields)[number]>()

        // Fast path: read whatever the field-value store already holds.
        for (const field of resource.fields) {
          if (!field.fieldType) continue
          const ref = (field.resourceFieldId ?? field.id) as FieldReference
          const key = buildFieldValueKey(normalized, ref)
          if (key in stored) {
            data[getFieldOutputKey(field)] = unwrapValue(
              stored[key] as TypedFieldValue | TypedFieldValue[] | null,
              field.fieldType as FieldType
            )
          } else {
            missing.push(ref)
            refToField.set(fieldRefToKey(ref), field)
          }
        }

        // Slow path: authoritative read for fields the store hasn't cached.
        if (missing.length > 0) {
          try {
            const result = await batchGetAsync({
              recordIds: [normalized],
              fieldReferences: missing,
            })
            for (const row of result.values) {
              const field = refToField.get(fieldRefToKey(row.fieldRef))
              if (field) data[getFieldOutputKey(field)] = unwrapValue(row.value, row.fieldType)
            }
          } catch {
            // Best-effort: uncached fields are simply absent from `data`.
          }
        }

        return {
          id: entityInstanceId,
          type: resource.entityType ?? entityDefinitionId,
          displayName: meta?.displayName ?? undefined,
          data,
          createdAt: meta?.createdAt,
          updatedAt: meta?.updatedAt,
        }
      }
    )

    return unsubscribe
  }, [messageClient, getResourceById, batchGetAsync])

  return null
}
