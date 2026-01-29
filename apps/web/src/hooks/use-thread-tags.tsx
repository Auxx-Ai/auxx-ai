// apps/web/src/hooks/use-thread-tags.tsx
// NOTE: This hook uses the legacy api.tag.updateEntityTags mutation.
// For new code, consider using useThreadTags from '~/components/tags/hooks/use-thread-tags'
// which uses useSaveFieldValue for the RELATIONSHIP field type.

import { useState, useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import type { ThreadMeta } from '~/components/threads/store'

/**
 * Hook for managing thread tags using the legacy api.tag.updateEntityTags mutation.
 * For new code, consider using useThreadTags from '~/components/tags/hooks/use-thread-tags'.
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

  const updateEntityTags = api.tag.updateEntityTags.useMutation({
    onMutate: async (variables) => {
      if (!thread) return

      // Cancel any outgoing queries
      await utils.thread.getById.cancel({ threadId: thread.id })

      // Snapshot previous data
      const previousThread = utils.thread.getById.getData({ threadId: thread.id })

      // Optimistically update React Query cache (nested structure for getById endpoint)
      // Note: This hook receives data from Zustand store (flat), but we maintain
      // the correct nested structure here for React Query cache consistency
      utils.thread.getById.setData({ threadId: thread.id }, (old) => {
        if (!old) return old
        return {
          ...old,
          tags: variables.tagIds.map((tagId) => ({
            tag: { id: tagId, title: 'Loading...', color: '#gray', emoji: '', description: null },
          })),
        }
      })

      return { previousThread }
    },
    onError: (err, variables, context) => {
      if (!thread) return

      // Rollback optimistic update
      if (context?.previousThread) {
        utils.thread.getById.setData({ threadId: thread.id }, context.previousThread)
      }
      toastError({ title: 'Failed to update tags', description: err.message })
    },
    onSuccess: (result) => {
      toastSuccess({ title: `Tags updated (${result.added} added, ${result.removed} removed)` })
      // Invalidate list data - only if contextType is valid
      if (isValidContextType) {
        utils.thread.list.invalidate({
          contextType: contextType as any,
          contextId,
          statusSlug,
          searchQuery,
        })
      }
    },
    onSettled: (data, error, variables) => {
      if (!thread) return

      // Invalidate thread query to get fresh data from server
      utils.thread.getById.invalidate({ threadId: thread.id })
    },
  })

  const handleTagChange = async (incomingTagIds: string[]) => {
    if (!thread) return

    // TagPicker passes an array of tag IDs directly
    const newTagIds = [...incomingTagIds.filter(Boolean)]
    const currentTagIds = [...selectedTagIds] // Use current selectedTagIds state

    // Update local state immediately for responsiveness
    setSelectedTagIds([...newTagIds])
    setSelectedTags([...newTagIds])

    try {
      // Use the optimistic updateEntityTags mutation
      await updateEntityTags.mutateAsync({
        tagIds: newTagIds,
        entityId: thread.id,
        entityType: 'thread',
      })
    } catch (error) {
      console.error('Error updating tags:', error)
      // Revert optimistic update on error
      setSelectedTagIds([...currentTagIds])
      setSelectedTags([...currentTagIds])
    }
  }

  return {
    selectedTags,
    selectedTagIds,
    fetchedTagsData,
    handleTagChange,
    updateEntityTags,
  }
}
