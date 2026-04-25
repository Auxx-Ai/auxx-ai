// ~/components/resources/hooks/use-resource-sync.ts

'use client'

import type {
  FieldValuesUpdatedEvent,
  RecordArchivedEvent,
  RecordCreatedEvent,
  RecordDeletedEvent,
  RecordUpdatedEvent,
} from '@auxx/lib/realtime'
import { useCallback, useEffect } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useFieldValueStore } from '../store/field-value-store'
import { useRecordStore } from '../store/record-store'

/**
 * Global hook that subscribes to real-time resource events on the org channel
 * and feeds data into the existing Zustand stores.
 * Mount once in the app layout.
 */
export function useResourceSync() {
  const orgChannel = useOrgChannel()
  const { hasAccess } = useFeatureFlags()
  const realtimeSyncEnabled = hasAccess('realtimeSync')
  const utils = api.useUtils()

  // Store actions (selectors to avoid re-renders)
  const setValues = useFieldValueStore((s) => s.setValues)
  const setAiState = useFieldValueStore((s) => s.setAiState)
  const invalidateResource = useFieldValueStore((s) => s.invalidateResource)
  const setRecords = useRecordStore((s) => s.setRecords)
  const updateRecord = useRecordStore((s) => s.updateRecord)
  const removeRecord = useRecordStore((s) => s.removeRecord)
  const invalidateLists = useRecordStore((s) => s.invalidateLists)

  // Merge fieldValues:updated into the store. An entry with `value` present
  // goes through `setValues` (which preserves the pending-optimistic skip).
  // An entry with `aiStatus` present writes the AI marker — `null` clears it.
  const handleFieldValuesUpdated = useCallback(
    (raw: unknown) => {
      const data = raw as FieldValuesUpdatedEvent['data']
      const valueEntries = data.entries.filter((e) => e.value !== undefined) as Array<{
        key: (typeof data.entries)[number]['key']
        value: unknown
      }>
      if (valueEntries.length > 0) setValues(valueEntries)

      for (const entry of data.entries) {
        if (entry.aiStatus !== undefined) {
          setAiState(entry.key, entry.aiStatus, entry.aiMetadata ?? null)
        }
      }
    },
    [setValues, setAiState]
  )

  const handleRecordCreated = useCallback(
    (raw: unknown) => {
      const data = raw as RecordCreatedEvent['data']
      setRecords(data.entityDefinitionId, [data.record as any])
      invalidateLists(data.entityDefinitionId)
      utils.record.listFiltered.invalidate({ entityDefinitionId: data.entityDefinitionId })
      if (data.fieldValues?.length) {
        setValues(data.fieldValues)
      }
    },
    [setRecords, invalidateLists, setValues, utils]
  )

  // Partial-update the cached record if we already have it. If the tab never
  // fetched this record, do nothing — `useRecord` will fetch fresh when a
  // component first mounts a card for it.
  //
  // Merge only keys present on the payload. The field-value layer emits
  // column-specific events (`{ displayName }` or `{ avatarUrl }` only), so
  // treat `undefined` as "don't touch" and `null` as "clear".
  const handleRecordUpdated = useCallback(
    (raw: unknown) => {
      const data = raw as RecordUpdatedEvent['data']
      const { displayName, secondaryDisplayValue, avatarUrl, updatedAt } = data.record
      const patch: Record<string, unknown> = {}
      if (displayName !== undefined) patch.displayName = displayName
      if (secondaryDisplayValue !== undefined) patch.secondaryDisplayValue = secondaryDisplayValue
      if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl
      if (updatedAt !== undefined) patch.updatedAt = updatedAt
      if (Object.keys(patch).length === 0) return
      updateRecord(data.entityDefinitionId, data.record.id, patch)
    },
    [updateRecord]
  )

  const handleRecordDeleted = useCallback(
    (raw: unknown) => {
      const data = raw as RecordDeletedEvent['data']
      removeRecord(data.entityDefinitionId, data.recordId)
      invalidateLists(data.entityDefinitionId)
      invalidateResource(data.recordId)
      utils.record.listFiltered.invalidate({ entityDefinitionId: data.entityDefinitionId })
    },
    [removeRecord, invalidateLists, invalidateResource, utils]
  )

  const handleRecordArchived = useCallback(
    (raw: unknown) => {
      const data = raw as RecordArchivedEvent['data']
      invalidateLists(data.entityDefinitionId)
      utils.record.listFiltered.invalidate({ entityDefinitionId: data.entityDefinitionId })
    },
    [invalidateLists, utils]
  )

  useEffect(() => {
    if (!orgChannel || !realtimeSyncEnabled) return

    orgChannel.bind('fieldValues:updated', handleFieldValuesUpdated)
    orgChannel.bind('record:created', handleRecordCreated)
    orgChannel.bind('record:updated', handleRecordUpdated)
    orgChannel.bind('record:deleted', handleRecordDeleted)
    orgChannel.bind('record:archived', handleRecordArchived)

    return () => {
      orgChannel.unbind('fieldValues:updated', handleFieldValuesUpdated)
      orgChannel.unbind('record:created', handleRecordCreated)
      orgChannel.unbind('record:updated', handleRecordUpdated)
      orgChannel.unbind('record:deleted', handleRecordDeleted)
      orgChannel.unbind('record:archived', handleRecordArchived)
    }
  }, [
    orgChannel,
    realtimeSyncEnabled,
    handleFieldValuesUpdated,
    handleRecordCreated,
    handleRecordUpdated,
    handleRecordDeleted,
    handleRecordArchived,
  ])
}
