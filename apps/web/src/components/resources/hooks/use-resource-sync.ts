// ~/components/resources/hooks/use-resource-sync.ts

'use client'

import type {
  FieldValuesUpdatedEvent,
  RecordArchivedEvent,
  RecordCreatedEvent,
  RecordDeletedEvent,
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
  const invalidateResource = useFieldValueStore((s) => s.invalidateResource)
  const setRecords = useRecordStore((s) => s.setRecords)
  const removeRecord = useRecordStore((s) => s.removeRecord)
  const invalidateLists = useRecordStore((s) => s.invalidateLists)

  const handleFieldValuesUpdated = useCallback(
    (raw: unknown) => {
      const data = raw as FieldValuesUpdatedEvent['data']
      setValues(data.entries)
    },
    [setValues]
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
    orgChannel.bind('record:deleted', handleRecordDeleted)
    orgChannel.bind('record:archived', handleRecordArchived)

    return () => {
      orgChannel.unbind('fieldValues:updated', handleFieldValuesUpdated)
      orgChannel.unbind('record:created', handleRecordCreated)
      orgChannel.unbind('record:deleted', handleRecordDeleted)
      orgChannel.unbind('record:archived', handleRecordArchived)
    }
  }, [
    orgChannel,
    realtimeSyncEnabled,
    handleFieldValuesUpdated,
    handleRecordCreated,
    handleRecordDeleted,
    handleRecordArchived,
  ])
}
