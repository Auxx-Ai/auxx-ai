// apps/web/src/components/tags/hooks/use-thread-tags.ts
// Simplified hook for managing thread tags using the FieldValue system.
// Uses useSaveFieldValue with RELATIONSHIP field type.

import { useState, useEffect, useCallback } from 'react'
import { toastError } from '@auxx/ui/components/toast'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useResource, useSystemField } from '~/components/resources/hooks'
import { useThread } from '~/components/threads/hooks'
import { toRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'

/**
 * Hook for managing thread tags using the FieldValue system.
 * Uses useSaveFieldValue with RELATIONSHIP field type for tag assignment.
 *
 * @param threadId The thread ID to manage tags for
 * @returns Tag state and operations: { selectedTags, handleTagChange, isPending }
 */
export function useThreadTags(threadId: string) {
  const [selectedTags, setSelectedTags] = useState<RecordId[]>([])

  // Get thread from store
  const { thread } = useThread({ threadId })

  // Get entity definition IDs for thread
  const { resource: threadResource } = useResource('thread')
  const threadEntityDefId = threadResource?.entityDefinitionId ?? null

  // Get the tags field with actual CustomField UUID
  const tagsField = useSystemField('thread_tags')
  const tagsFieldId = tagsField?.id ?? null

  // Sync local tag state with thread tags from store (now RecordId[])
  useEffect(() => {
    if (thread?.tagIds) {
      setSelectedTags([...thread.tagIds])
    } else {
      setSelectedTags([])
    }
  }, [thread?.tagIds])

  // Use the unified field value save hook (no invalidation callbacks needed - zustand handles state)
  const { saveFieldValue, isPending } = useSaveFieldValue()

  /**
   * Handle tag change - updates thread's tags using FieldValue relationship
   * Accepts RecordId[] directly (no conversion needed)
   */
  const handleTagChange = useCallback(
    async (incomingTagIds: RecordId[]) => {
      if (!thread || !threadEntityDefId || !tagsFieldId) {
        console.warn('Cannot update tags: missing thread, entity definition ID, or tags field')
        return
      }

      // Filter out any invalid entries
      const newTagIds = [...incomingTagIds.filter(Boolean)]
      const currentTagIds = [...selectedTags]

      // Update local state immediately for responsiveness (optimistic update)
      setSelectedTags([...newTagIds])

      try {
        // Build the thread RecordId
        const threadRecordId = toRecordId(threadEntityDefId, thread.id)

        // Save via FieldValue system with RELATIONSHIP field type
        // newTagIds is already RecordId[] - no conversion needed
        saveFieldValue(threadRecordId, tagsFieldId, newTagIds, 'RELATIONSHIP')
      } catch (error) {
        console.error('Error updating tags:', error)
        // Revert optimistic update on error
        setSelectedTags([...currentTagIds])
        toastError({
          title: 'Failed to update tags',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [thread, threadEntityDefId, tagsFieldId, selectedTags, saveFieldValue]
  )

  return {
    selectedTags,
    handleTagChange,
    isPending,
  }
}
