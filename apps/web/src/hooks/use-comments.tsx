'use client'
import type { RecordId } from '@auxx/lib/field-values/client'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
// hooks/useComments.ts
import { useState } from 'react'
import { api } from '~/trpc/react'

// System entity types
export const SYSTEM_ENTITY_TYPES = ['Ticket', 'Thread', 'Contact'] as const
export type SystemEntityType = (typeof SYSTEM_ENTITY_TYPES)[number]

// Can be system type or entityDefinitionId for custom entities
export type CommentableEntityType = string

/**
 * Check if entityType is a system type or a custom entity definition ID
 * Handles both lowercase ('ticket', 'contact', 'thread') and capital case
 */
export function isSystemEntityType(entityType: string): entityType is SystemEntityType {
  const normalized = entityType.toLowerCase()
  return normalized === 'ticket' || normalized === 'thread' || normalized === 'contact'
}

export type ReactionType = 'like' | 'emoji'

// Frontend file type distinction
interface FileAttachment {
  id: string
  name: string
  size?: bigint | number
  mimeType?: string
  type: 'file' | 'asset' // 'file' = FolderFile, 'asset' = MediaAsset
}

export interface UseCommentsOptions {
  // Entity identifier (RecordId format: "entityType:entityId")
  recordId?: RecordId

  // Single comment option
  commentId?: string
  comment?: Comment

  // Additional options
  initialComments?: Comment[]
  onCommentAdded?: () => void
}

// Types for comments and related data
export type AggregatedReactions = {
  likes: { count: number; userReacted: boolean }
  emojis: { [emoji: string]: { count: number; userReacted: boolean } }
}

export type CommentMention = {
  id: string
  userId: string
  user: { id: string; name: string | null }
}

// Comment attachment info for display
export type CommentAttachmentInfo = {
  id: string
  role: string
  title?: string | null
  sort: number
  createdAt: Date
  type: 'file' | 'asset'
  fileId: string
  name: string
  mimeType?: string | null
  size?: bigint | null
}

export type Comment = {
  id: string
  content: string
  recordId: string
  createdAt: Date
  updatedAt: Date
  actorId: string // ActorId (e.g. "user:abc123") - use useActor to resolve
  isPinned: boolean
  pinnedById?: string | null // User ID - use useActor to resolve user info
  pinnedAt?: Date | null
  attachments?: CommentAttachmentInfo[]
  mentions: CommentMention[]
  reactions: AggregatedReactions
  replies?: Comment[]
  parentId?: string | null
}

export function useComments({
  recordId,
  commentId,
  comment: initialComment,
  initialComments,
  onCommentAdded,
}: UseCommentsOptions) {
  const utils = api.useUtils()
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [replyingToId, setReplyingToId] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [pinningCommentId, setPinningCommentId] = useState<string | null>(null)
  const [addingEmojiToCommentId, setAddingEmojiToCommentId] = useState<string | null>(null)

  // For multiple comments (entity-based)
  const {
    data: fetchedCommentsData,
    isLoading: isFetchingComments,
    refetch: refetchComments,
  } = api.comment.getByRecordId.useQuery(
    { recordId: recordId! },
    {
      // Only run this query if we have a recordId and no commentId
      enabled: !!(recordId && !commentId && !initialComment && !initialComments),
      refetchOnWindowFocus: false,
    }
  )

  // For single comment (comment-based)
  const {
    data: fetchedComment,
    isLoading: isFetchingSingleComment,
    refetch: refetchSingleComment,
  } = api.comment.getById.useQuery(
    { id: commentId! },
    {
      // Only run this query if we have a commentId and no initialComment
      enabled: !!(commentId && !initialComment),
      refetchOnWindowFocus: false,
    }
  )

  // Determine which comments to use
  const comments = initialComments || fetchedCommentsData?.comments || []
  const singleComment = initialComment || fetchedComment?.comment

  // Whether we're in single comment mode
  const isSingleCommentMode = !!commentId || !!initialComment

  // API mutations
  const createComment = api.comment.create.useMutation({
    onSuccess: () => {
      // Invalidate all getByRecordId queries for this recordId
      if (recordId) {
        utils.comment.getByRecordId.invalidate({ recordId })
      }
      if (onCommentAdded) {
        onCommentAdded()
      }
      toastSuccess({ title: 'Comment added' })
    },
    onError: (error) => {
      toastError({ title: 'Error adding comment', description: error.message })
    },
  })

  const createReply = api.comment.create.useMutation({
    onSuccess: () => {
      setReplyingToId(null)
      // Invalidate all getByRecordId queries for this recordId
      if (recordId) {
        utils.comment.getByRecordId.invalidate({ recordId })
      }
      toastSuccess({ title: 'Reply added' })
    },
    onError: (error) => {
      toastError({ title: 'Error adding reply', description: error.message })
    },
  })

  const updateComment = api.comment.update.useMutation({
    onSuccess: () => {
      setEditingCommentId(null)
      if (isSingleCommentMode) {
        refetchSingleComment()
      } else {
        refetchComments()
      }
      toastSuccess({ title: 'Comment updated' })
    },
    onError: (error) => {
      toastError({
        title: 'Error updating comment',
        description: error.message,
      })
    },
  })

  const deleteComment = api.comment.delete.useMutation({
    onSuccess: () => {
      if (isSingleCommentMode) {
        refetchSingleComment()
      } else {
        refetchComments()
      }
      toastSuccess({ title: 'Comment deleted' })
    },
    onError: (error) => {
      toastError({
        title: 'Error deleting comment',
        description: error.message,
      })
    },
  })

  const togglePin = api.comment.togglePin.useMutation({
    onSuccess: () => {
      if (isSingleCommentMode) {
        refetchSingleComment()
      } else {
        refetchComments()
      }
      toastSuccess({ title: 'Comment pinned status updated' })
    },
    onError: (error) => {
      toastError({
        title: 'Error changing pin status',
        description: error.message,
      })
    },
  })

  const addReaction = api.comment.addReaction.useMutation({
    onSuccess: () => {
      if (isSingleCommentMode) {
        refetchSingleComment()
      } else {
        refetchComments()
      }
    },
    onError: (error) => {
      toastError({ title: 'Error adding reaction', description: error.message })
    },
  })

  const removeReaction = api.comment.removeReaction.useMutation({
    onSuccess: () => {
      if (isSingleCommentMode) {
        refetchSingleComment()
      } else {
        refetchComments()
      }
    },
    onError: (error) => {
      toastError({
        title: 'Error removing reaction',
        description: error.message,
      })
    },
  })

  // Action handlers
  const handleCreateComment = async (content: string, fileAttachments?: FileAttachment[]) => {
    console.log('handleCreateComment', recordId)
    if (!content.trim() || !recordId) return

    await createComment.mutateAsync({ content, recordId, fileAttachments })
  }

  const handleCreateReply = async (
    content: string,
    parentId: string,
    fileAttachments?: FileAttachment[]
  ) => {
    if (!content.trim() || !recordId) return

    await createReply.mutateAsync({ content, recordId, parentId, fileAttachments })
  }

  const handleUpdateComment = async (
    commentId: string,
    content: string,
    fileAttachments?: FileAttachment[]
  ) => {
    if (!content.trim()) return

    await updateComment.mutateAsync({ id: commentId, content, fileAttachments })
  }

  const handleDeleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId)
    try {
      await deleteComment.mutateAsync({ id: commentId })
    } finally {
      setDeletingCommentId(null)
    }
  }

  const handleTogglePin = async (commentId: string, isPinned: boolean) => {
    setPinningCommentId(commentId)
    try {
      await togglePin.mutateAsync({ id: commentId, pin: !isPinned })
    } finally {
      setPinningCommentId(null)
    }
  }

  const handleToggleLike = async (commentId: string, userReacted: boolean) => {
    if (userReacted) {
      await removeReaction.mutateAsync({ commentId, type: 'like' })
    } else {
      await addReaction.mutateAsync({ commentId, type: 'like' })
    }
  }

  const handleToggleEmoji = async (commentId: string, emoji: string, userReacted: boolean) => {
    if (userReacted) {
      await removeReaction.mutateAsync({ commentId, type: 'emoji', emoji })
    } else {
      await addReaction.mutateAsync({ commentId, type: 'emoji', emoji })
    }
  }

  const handleAddEmoji = async (commentId: string, emoji: string) => {
    setAddingEmojiToCommentId(commentId)
    try {
      await addReaction.mutateAsync({ commentId, type: 'emoji', emoji })
    } finally {
      setAddingEmojiToCommentId(null)
    }
  }

  return {
    // Data
    comments,
    singleComment,
    isSingleCommentMode,

    // Loading states
    isFetchingComments: isFetchingComments || isFetchingSingleComment,

    // UI state
    editingCommentId,
    setEditingCommentId,
    replyingToId,
    setReplyingToId,

    // Mutations state
    isCreatingComment: createComment.isPending,
    isCreatingReply: createReply.isPending,
    isUpdatingComment: updateComment.isPending,
    isDeletingComment: deleteComment.isPending,
    isTogglingPin: togglePin.isPending,

    // Helper to check if a specific comment is being updated
    isUpdating: (commentId: string) => {
      return (
        deletingCommentId === commentId ||
        pinningCommentId === commentId ||
        addingEmojiToCommentId === commentId
      )
    },

    // Individual action states by comment ID
    deletingCommentId,
    pinningCommentId,
    addingEmojiToCommentId,

    // Action handlers
    handleCreateComment,
    handleCreateReply,
    handleUpdateComment,
    handleDeleteComment,
    handleTogglePin,
    handleToggleLike,
    handleToggleEmoji,
    handleAddEmoji,

    // Utilities
    refreshComments: isSingleCommentMode ? refetchSingleComment : refetchComments,
  }
}
