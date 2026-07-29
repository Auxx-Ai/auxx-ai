// apps/web/src/components/resources/hooks/use-create-record.ts
'use client'

import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/lib/resources/client'
import { toResourceFieldId } from '@auxx/types/field'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { resolveSystemAttributeRef } from '~/components/resources/utils/resolve-system-attribute'
import { api } from '~/trpc/react'
import {
  type CreatedRecordInstance,
  type SeedFieldValue,
  useSeedCreatedRecord,
} from './use-seed-created-record'

/** A single record's field values, keyed by systemAttribute (snake_case),
 *  ResourceFieldId (`${defId}:${fieldId}`), or raw field UUID. Relationship
 *  value = RecordId or RecordId[] (both normalize downstream). */
export interface CreateRecordInput {
  values: Record<string, unknown>
}

/** What every `create`/`createMany` row resolves to, whichever method ran. */
export interface CreatedRecordResult {
  recordId: RecordId
  instanceId: string
  instance: CreatedRecordInstance
}

export interface UseCreateRecordOptions {
  entityDefinitionId: string
  /** record-store list to append the new id into (from `useRecordList().listKey`).
   *  Omit for catalog/standalone surfaces (seeds row data only, no list membership). */
  listKey?: string
  /** Surface-specific extras the hook can't know about: navigation, relationship
   *  hydration, standalone-query (`['calendar-record-ids']`) invalidation, or the
   *  `record.listAll` catalog push. Fires once per created row, after it's seeded. */
  onCreated?: (result: CreatedRecordResult) => void
}

/**
 * One canonical record-creation hook. Calls `api.record.create` (single) or
 * `api.record.createMany` (bulk), then **seeds the client caches directly from
 * the caller's input values** (record-store + field-value-store) so the creating
 * user sees the new row with zero refetch — `record.create` deliberately excludes
 * the originating socket from its `record:created` realtime event
 * (`unified-handler-mutations.ts`), so seeding is the creator's only instant path.
 *
 * Seeds from the caller's `values` (not the server result) because `createMany`
 * returns no `values`; this keeps single + bulk uniform and preserves `fieldType`
 * for `formatToTypedInput`. Errors surface through one shared `toastError`.
 */
export function useCreateRecord(opts: UseCreateRecordOptions): {
  create: (input: CreateRecordInput) => Promise<CreatedRecordResult>
  createMany: (inputs: CreateRecordInput[]) => Promise<CreatedRecordResult[]>
  isPending: boolean
} {
  const { entityDefinitionId, listKey, onCreated } = opts
  const { seedCreatedRecord } = useSeedCreatedRecord()
  const createMutation = api.record.create.useMutation()
  const createManyMutation = api.record.createMany.useMutation()

  /** Resolve each input value's `fieldType` from the resource store so the seed
   *  builds typed field values. Keys may be systemAttribute, ResourceFieldId, or
   *  a bare field UUID — resolve via the systemAttribute map, then by ref. */
  const toSeedValues = useCallback(
    (values: Record<string, unknown>): SeedFieldValue[] => {
      const store = useResourceStore.getState()
      return Object.entries(values).map(([fieldId, value]) => {
        const ref = resolveSystemAttributeRef(store, fieldId, entityDefinitionId) ?? fieldId
        const field =
          store.getFieldByRef(ref) ??
          store.getFieldByRef(toResourceFieldId(entityDefinitionId, fieldId))
        return { fieldId, value, fieldType: field?.fieldType as FieldType | undefined }
      })
    },
    [entityDefinitionId]
  )

  const create = useCallback(
    async (input: CreateRecordInput): Promise<CreatedRecordResult> => {
      try {
        const result = await createMutation.mutateAsync({
          entityDefinitionId,
          values: input.values,
        })
        seedCreatedRecord({
          entityDefinitionId,
          recordId: result.recordId,
          listKey,
          instance: result.instance,
          values: toSeedValues(input.values),
        })
        const created: CreatedRecordResult = {
          recordId: result.recordId,
          instanceId: result.instance.id,
          instance: result.instance,
        }
        onCreated?.(created)
        return created
      } catch (error) {
        toastError({
          title: 'Error creating record',
          description: error instanceof Error ? error.message : 'Could not create the record',
        })
        throw error
      }
    },
    [entityDefinitionId, listKey, onCreated, seedCreatedRecord, toSeedValues, createMutation]
  )

  const createMany = useCallback(
    async (inputs: CreateRecordInput[]): Promise<CreatedRecordResult[]> => {
      try {
        const results = await createManyMutation.mutateAsync({
          entityDefinitionId,
          records: inputs.map((i) => i.values),
        })
        // Seed each row in input order — the server returns results in the same
        // order, so list-cache appends agree with any per-row sort stamps.
        return results.map((result, i) => {
          seedCreatedRecord({
            entityDefinitionId,
            recordId: result.recordId,
            listKey,
            instance: result.instance,
            values: toSeedValues(inputs[i]?.values ?? {}),
          })
          const created: CreatedRecordResult = {
            recordId: result.recordId,
            instanceId: result.instance.id,
            instance: result.instance,
          }
          onCreated?.(created)
          return created
        })
      } catch (error) {
        toastError({
          title: 'Error creating records',
          description: error instanceof Error ? error.message : 'Could not create the records',
        })
        throw error
      }
    },
    [entityDefinitionId, listKey, onCreated, seedCreatedRecord, toSeedValues, createManyMutation]
  )

  return {
    create,
    createMany,
    isPending: createMutation.isPending || createManyMutation.isPending,
  }
}
