// apps/web/src/components/tags/hooks/use-thread-tags.ts

import { useState, useEffect, useCallback } from 'react'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { toRecordId, type RecordId } from '@auxx/lib/resources/client'
import { useTagHierarchy } from './use-tag-hierarchy'
import type { TagNode } from '../types'

interface UseThreadTagsOptions {
  /** Thread RecordId (e.g., "thread-def-id:thread-instance-id") */
  threadRecordId: RecordId
  /** Current tag RecordIds on the thread */
  currentTagRecordIds: RecordId[]
}

interface UseThreadTagsResult {
  /** Currently selected tags */
  selectedTags: TagNode[]
  /** Selected tag IDs (instance IDs, not RecordIds) */
  selectedTagIds: string[]
  /** Handle tag selection change - accepts plain tag IDs */
  handleTagChange: (tagIds: string[]) => void
  /** Whether mutation is pending */
  isPending: boolean
}

/**
 * Hook for managing tags on a thread.
 * Uses the RELATIONSHIP field type via useSaveFieldValue.
 *
 * @example
 * ```tsx
 * import { useThreadTags } from '~/components/tags/hooks/use-thread-tags'
 *
 * const { selectedTags, handleTagChange, isPending } = useThreadTags({
 *   threadRecordId: toRecordId(threadEntityDefId, thread.id),
 *   currentTagRecordIds: thread.tags.map(t => toRecordId(tagEntityDefId, t.id)),
 * })
 * ```
 */
export function useThreadTags({
  threadRecordId,
  currentTagRecordIds,
}: UseThreadTagsOptions): UseThreadTagsResult {
  const { tagMap, entityDefinitionId } = useTagHierarchy()

  // Track selected tag IDs locally (instance IDs, not RecordIds)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])

  // Sync with current values from props
  useEffect(() => {
    // Extract instance IDs from RecordIds
    const ids = currentTagRecordIds
      .map((rid) => rid.split(':')[1] ?? '')
      .filter(Boolean)
    setSelectedTagIds(ids)
  }, [currentTagRecordIds])

  // Get selected TagNode objects
  const selectedTags = selectedTagIds
    .map((id) => tagMap.get(id))
    .filter((t): t is TagNode => t !== undefined)

  // Save field value mutation
  const { saveFieldValue, isPending } = useSaveFieldValue()

  // Handle tag change - accepts plain IDs, converts to RecordIds
  const handleTagChange = useCallback(
    (tagIds: string[]) => {
      if (!entityDefinitionId) return

      // Convert to RecordIds
      const recordIds = tagIds.map((id) => toRecordId(entityDefinitionId, id))

      // Optimistic update
      setSelectedTagIds(tagIds)

      // Save via useSaveFieldValue
      saveFieldValue(threadRecordId, 'tags', recordIds, 'RELATIONSHIP')
    },
    [entityDefinitionId, saveFieldValue, threadRecordId]
  )

  return {
    selectedTags,
    selectedTagIds,
    handleTagChange,
    isPending,
  }
}
