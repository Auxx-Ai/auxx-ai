// apps/web/src/components/threads/hooks/use-inbox.ts

import type { RecordId } from '@auxx/types'
import { useMemo } from 'react'
import { useAllRecords, type FieldInfo } from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'

/**
 * Inbox record type from useAllRecords.
 * Field keys use inbox_ prefix (e.g., inbox_name, inbox_color).
 */
export interface InboxRecord extends RecordMeta {
  fieldValues: {
    inbox_name?: string
    inbox_description?: string
    inbox_color?: string
    inbox_status?: 'ACTIVE' | 'ARCHIVED' | 'PAUSED'
    inbox_visibility?: 'org_members' | 'private' | 'custom'
  }
}

/**
 * Simplified inbox type for UI components
 */
export interface InboxItem {
  id: string
  recordId: RecordId
  name: string
  description?: string | null
  color?: string | null
  status?: string
}

/**
 * Result from useInboxes hook
 */
interface UseInboxesResult {
  /** All inboxes as simplified items */
  inboxes: InboxItem[]
  /** Raw records from store */
  records: InboxRecord[]
  /** Map for quick lookup by RecordId */
  inboxMap: Map<RecordId, InboxItem>
  /** Field definitions */
  fields: Record<string, FieldInfo>
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Refresh data */
  refresh: () => void
}

/**
 * Hook to fetch all inboxes using the entity system.
 * Uses useAllRecords internally for data fetching.
 */
export function useInboxes(): UseInboxesResult {
  const { records, fields, isLoading, error, refresh } = useAllRecords<InboxRecord>({
    entityDefinitionId: 'inbox',
  })

  // Transform records to simplified inbox items
  const { inboxes, inboxMap } = useMemo(() => {
    if (!records.length) {
      return { inboxes: [], inboxMap: new Map<RecordId, InboxItem>() }
    }

    const items: InboxItem[] = records.map((record) => ({
      id: record.id,
      recordId: record.recordId,
      name: record.fieldValues?.inbox_name ?? record.displayName ?? 'Untitled',
      description: record.fieldValues?.inbox_description ?? null,
      color: record.fieldValues?.inbox_color ?? null,
      status: record.fieldValues?.inbox_status,
    }))

    // Key map by recordId for direct lookup (thread.inboxId is now RecordId)
    const map = new Map<RecordId, InboxItem>(items.map((item) => [item.recordId, item]))

    return { inboxes: items, inboxMap: map }
  }, [records])

  return {
    inboxes,
    records,
    inboxMap,
    fields,
    isLoading,
    error,
    refresh,
  }
}

/**
 * Result of useInbox hook
 */
interface UseInboxResult {
  inbox: InboxItem | undefined
  isLoading: boolean
}

/**
 * Hook to get a single inbox by RecordId.
 * Since thread.inboxId is now RecordId, lookup is direct.
 */
export function useInbox(inboxId: RecordId | null | undefined): UseInboxResult {
  const { inboxMap, isLoading } = useInboxes()

  const inbox = useMemo(() => {
    if (!inboxId) return undefined
    return inboxMap.get(inboxId) // Direct lookup by recordId
  }, [inboxId, inboxMap])

  return { inbox, isLoading }
}
