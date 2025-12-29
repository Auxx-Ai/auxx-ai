// src/hooks/use-thread-tags.tsx
import { useState, useEffect, useMemo } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

// Type for thread with tags
type Thread = RouterOutputs['thread']['getById']

/**
 * Optimized hook for managing thread tags using existing thread data
 * @param thread The thread object (with tags already loaded)
 * @param contextParams Context parameters for invalidation
 * @returns Tag state and operations
 */
export function useThreadTags(
  thread: Thread | null,
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

  // Sync local tag state with thread tags
  useEffect(() => {
    if (thread?.tags) {
      const tagIds = thread.tags.map((tagRel) => tagRel.tag.id)
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

      // Optimistically update thread with new tags
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
