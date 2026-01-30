// apps/web/src/hooks/use-thread-tags.tsx
// Hook for managing thread tags using the unified FieldValue system.
// Uses useSaveFieldValue with RELATIONSHIP field type.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useResource, useSystemField } from '~/components/resources/hooks'
import { toRecordId } from '@auxx/lib/resources/client'
import type { ThreadMeta } from '~/components/threads/store'
import type { RecordId } from '@auxx/types/resource'

/**
 * Hook for managing thread tags using the FieldValue system.
 * Uses useSaveFieldValue with RELATIONSHIP field type for tag assignment.
 *
 * @param thread The thread object from store (with flat tags structure)
 * @param contextParams Context parameters for invalidation
 * @returns Tag state and operations
 */
export function useThreadTags(
  thread: ThreadMeta | null | undefined,
  contextParams: {
    contextType: string
    contextId?: string
    statusSlug?: string
    searchQuery?: string
  }
) {
  const { contextType, contextId, statusSlug, searchQuery } = contextParams

  // Valid context types that match the thread router schema
  const validContextTypes = [
    'personal_assigned',
    'personal_inbox',
    'drafts',
    'sent',
    'tag',
    'view',
    'all_inboxes',
    'all',
    'specific_inbox',
  ] as const

  // Check if contextType is valid for thread list invalidation
  const isValidContextType = validContextTypes.includes(contextType as any)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const utils = api.useUtils()

  // Get entity definition IDs for thread and tag from resource store
  const { resource: threadResource } = useResource('thread')
  const { resource: tagResource } = useResource('tag')

  const threadEntityDefId = threadResource?.entityDefinitionId ?? null
  const tagEntityDefId = tagResource?.entityDefinitionId ?? null

  // Get the tags field with actual CustomField UUID
  const tagsField = useSystemField('thread_tags')
  const tagsFieldId = tagsField?.id ?? null

  // Extract tags from thread data (no separate API call needed)
  const fetchedTagsData = useMemo(() => {
    return thread?.tags || []
  }, [thread?.tags])

  // Sync local tag state with thread tags (flat structure from store)
  useEffect(() => {
    if (thread?.tags) {
      const tagIds = thread.tags.map((tag) => tag.id)
      setSelectedTags(tagIds)
      setSelectedTagIds(tagIds)
    } else {
      setSelectedTags([])
      setSelectedTagIds([])
    }
  }, [thread?.tags])

  // Use the unified field value save hook
  const { saveFieldValue, isPending } = useSaveFieldValue({
    onSuccess: () => {
      // Invalidate list data - only if contextType is valid
      if (isValidContextType && thread) {
        utils.thread.list.invalidate({
          contextType: contextType as any,
          contextId,
          statusSlug,
          searchQuery,
        })
        utils.thread.getById.invalidate({ threadId: thread.id })
      }
    },
  })

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
      const currentTagIds = [...selectedTagIds]

      // Update local state immediately for responsiveness
      setSelectedTagIds([...newTagIds])
      setSelectedTags([...newTagIds])

      try {
        // Convert tag IDs to RecordIds
        const tagRecordIds: RecordId[] = newTagIds.map((tagId) => toRecordId(tagEntityDefId, tagId))

        // Build the thread RecordId
        const threadRecordId = toRecordId(threadEntityDefId, thread.id)

        // Save via FieldValue system with RELATIONSHIP field type
        // Use the actual CustomField UUID from useSystemField
        saveFieldValue(threadRecordId, tagsFieldId, tagRecordIds, 'RELATIONSHIP')
      } catch (error) {
        console.error('Error updating tags:', error)
        // Revert optimistic update on error
        setSelectedTagIds([...currentTagIds])
        setSelectedTags([...currentTagIds])
        toastError({
          title: 'Failed to update tags',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [thread, threadEntityDefId, tagEntityDefId, tagsFieldId, selectedTagIds, saveFieldValue]
  )

  return {
    selectedTags,
    selectedTagIds,
    fetchedTagsData,
    handleTagChange,
    isPending,
    // Legacy compatibility
    updateEntityTags: { isPending },
  }
}
