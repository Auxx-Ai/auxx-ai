// apps/web/src/components/threads/hooks/use-inbox.ts

import { useMemo } from 'react'
import { useAllRecords, type FieldInfo } from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'

/**
 * Inbox record type from useAllRecords.
 * Field keys come from inbox-fields.ts `key` property.
 */
export interface InboxRecord extends RecordMeta {
  fieldValues: {
    name?: string
    description?: string
    color?: string
    status?: 'ACTIVE' | 'ARCHIVED' | 'PAUSED'
    visibility?: 'org_members' | 'private' | 'custom'
  }
}

/**
 * Simplified inbox type for UI components
 */
export interface InboxItem {
  id: string
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
  /** Map for quick lookup by ID */
  inboxMap: Map<string, InboxItem>
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
      return { inboxes: [], inboxMap: new Map<string, InboxItem>() }
    }

    const items: InboxItem[] = records.map((record) => ({
      id: record.id,
      name: record.fieldValues?.name ?? record.displayName ?? 'Untitled',
      description: record.fieldValues?.description ?? null,
      color: record.fieldValues?.color ?? null,
      status: record.fieldValues?.status,
    }))

    const map = new Map<string, InboxItem>(items.map((item) => [item.id, item]))

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
 * Hook to get a single inbox by ID.
 */
export function useInbox(inboxId: string | null | undefined): UseInboxResult {
  const { inboxMap, isLoading } = useInboxes()

  const inbox = useMemo(() => {
    if (!inboxId) return undefined
    return inboxMap.get(inboxId)
  }, [inboxId, inboxMap])

  return { inbox, isLoading }
}
