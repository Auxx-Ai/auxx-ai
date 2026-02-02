// apps/web/src/components/tags/hooks/use-thread-tags.ts

import { useCallback } from 'react'
import { toastError } from '@auxx/ui/components/toast'
import { useResource, useSystemField } from '~/components/resources/hooks'
import { useThread } from '~/components/threads/hooks'
import { useThreadStore } from '~/components/threads/store'
import { toRecordId } from '@auxx/lib/resources/client'
import { api } from '~/trpc/react'
import type { RecordId } from '@auxx/types/resource'

/**
 * Hook for managing thread tags with optimistic updates to ThreadStore.
 * Uses direct ThreadStore mutation for immediate UI feedback.
 *
 * @param threadId The thread ID to manage tags for
 * @returns Tag state and operations: { selectedTags, handleTagChange, isPending }
 */
export function useThreadTags(threadId: string) {
  // Get thread from store (single source of truth)
  const { thread } = useThread({ threadId })

  // ThreadStore optimistic update methods
  const updateThreadOptimistic = useThreadStore((s) => s.updateThreadOptimistic)
  const confirmOptimistic = useThreadStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useThreadStore((s) => s.rollbackOptimistic)

  // Get entity definition ID for thread
  const { resource: threadResource } = useResource('thread')
  const threadEntityDefId = threadResource?.entityDefinitionId ?? null

  // Get the tags field ID
  const tagsField = useSystemField('thread_tags')
  const tagsFieldId = tagsField?.id ?? null

  // Direct tRPC mutation (not useSaveFieldValue)
  const mutation = api.fieldValue.set.useMutation()

  // Tags come directly from thread store (no local state)
  const selectedTags = thread?.tagIds ?? []

  /**
   * Handle tag change with optimistic update to ThreadStore.
   * @param incomingTagIds New tag RecordIds
   */
  const handleTagChange = useCallback(
    (incomingTagIds: RecordId[]) => {
      if (!thread || !threadEntityDefId || !tagsFieldId) {
        console.warn('Cannot update tags: missing thread, entity definition ID, or tags field')
        return
      }

      // Filter out invalid entries
      const newTagIds = incomingTagIds.filter(Boolean)

      // 1. Apply optimistic update to ThreadStore (immediate UI feedback)
      const version = updateThreadOptimistic(threadId, { tagIds: newTagIds })

      // 2. Build RecordId and fire mutation
      const threadRecordId = toRecordId(threadEntityDefId, thread.id)

      mutation.mutate(
        {
          recordId: threadRecordId,
          fieldId: tagsFieldId,
          value: newTagIds,
        },
        {
          onSuccess: () => {
            // Confirm the optimistic update
            confirmOptimistic(threadId, version)
          },
          onError: (error) => {
            // Rollback and show error
            rollbackOptimistic(threadId, version)
            toastError({
              title: 'Failed to update tags',
              description: error.message,
            })
          },
        }
      )
    },
    [
      thread,
      threadId,
      threadEntityDefId,
      tagsFieldId,
      updateThreadOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      mutation,
    ]
  )

  return {
    selectedTags,
    handleTagChange,
    isPending: mutation.isPending,
  }
}
