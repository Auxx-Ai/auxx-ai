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
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Get thread from store
  const { thread } = useThread({ threadId })

  // Get entity definition IDs for thread and tag from resource store
  const { resource: threadResource } = useResource('thread')
  const { resource: tagResource } = useResource('tag')

  const threadEntityDefId = threadResource?.entityDefinitionId ?? null
  const tagEntityDefId = tagResource?.entityDefinitionId ?? null

  // Get the tags field with actual CustomField UUID
  const tagsField = useSystemField('thread_tags')
  const tagsFieldId = tagsField?.id ?? null

  // Sync local tag state with thread tags from store
  useEffect(() => {
    if (thread?.tags) {
      const tagIds = thread.tags.map((tag) => tag.id)
      setSelectedTags(tagIds)
    } else {
      setSelectedTags([])
    }
  }, [thread?.tags])

  // Use the unified field value save hook (no invalidation callbacks needed - zustand handles state)
  const { saveFieldValue, isPending } = useSaveFieldValue()

  /**
   * Handle tag change - updates thread's tags using FieldValue relationship
   */
  const handleTagChange = useCallback(
    async (incomingTagIds: string[]) => {
      if (!thread || !threadEntityDefId || !tagEntityDefId || !tagsFieldId) {
        console.warn('Cannot update tags: missing thread, entity definition IDs, or tags field')
        return
      }

      // TagPicker passes an array of tag IDs directly
      const newTagIds = [...incomingTagIds.filter(Boolean)]
      const currentTagIds = [...selectedTags]

      // Update local state immediately for responsiveness (optimistic update)
      setSelectedTags([...newTagIds])

      try {
        // Convert tag IDs to RecordIds
        const tagRecordIds: RecordId[] = newTagIds.map((tagId) => toRecordId(tagEntityDefId, tagId))

        // Build the thread RecordId
        const threadRecordId = toRecordId(threadEntityDefId, thread.id)

        // Save via FieldValue system with RELATIONSHIP field type
        saveFieldValue(threadRecordId, tagsFieldId, tagRecordIds, 'RELATIONSHIP')
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
    [thread, threadEntityDefId, tagEntityDefId, tagsFieldId, selectedTags, saveFieldValue]
  )

  return {
    selectedTags,
    handleTagChange,
    isPending,
  }
}
