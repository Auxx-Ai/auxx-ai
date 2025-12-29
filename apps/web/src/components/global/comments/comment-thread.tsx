'use client'
// components/comments/comment-thread.tsx
import React, { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Textarea } from '@auxx/ui/components/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { format } from 'date-fns'
import { ThumbsUp, Reply, Pin, Trash, MoreHorizontal, FileIcon, Pencil } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { formatCommentContent } from '~/lib/sanitize'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EmojiPicker } from '~/components/pickers/emoji-picker'

// Types based on our enhanced comment service
type CommentUser = { id: string; name: string | null; image: string | null }

type AggregatedReactions = {
  likes: { count: number; userReacted: boolean }
  emojis: { [emoji: string]: { count: number; userReacted: boolean } }
}

type CommentFile = {
  id: string
  mediaAsset: {
    id: string
    name: string | null
    mimeType: string | null
    size: bigint | null
    currentVersion: {
      id: string
      storageLocation: {
        id: string
        provider: string
        bucket: string | null
        region: string | null
        path: string
      }
    } | null
  }
}

type CommentMention = {
  id: string
  userId: string
  user: { id: string; name: string | null }
}

type Comment = {
  id: string
  content: string
  createdAt: Date
  updatedAt: Date
  createdBy: CommentUser
  isPinned: boolean
  pinnedBy?: CommentUser | null
  pinnedAt?: Date | null
  files: CommentFile[]
  mentions: CommentMention[]
  reactions: AggregatedReactions
  replies?: Comment[]
  parentId?: string | null
}

interface CommentThreadProps {
  comments: Comment[]
  entityId: string
  entityType: 'Ticket' | 'Thread'
  onCommentAdded?: () => void
  refreshComments: () => void
}

export function CommentThread({
  comments,
  entityId,
  entityType,
  onCommentAdded,
  refreshComments,
}: CommentThreadProps) {
  const [newComment, setNewComment] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  // API mutations
  const createComment = api.comment.create.useMutation({
    onSuccess: () => {
      setNewComment('')
      if (onCommentAdded) {
        onCommentAdded()
      }
      refreshComments()
      toastSuccess({ title: 'Comment added' })
    },
    onError: (error) => {
      toastError({ title: 'Error adding comment', description: error.message })
    },
  })

  const createReply = api.comment.create.useMutation({
    onSuccess: () => {
      setReplyingTo(null)
      setReplyContent('')
      refreshComments()
      toastSuccess({ title: 'Reply added' })
    },
    onError: (error) => {
      toastError({ title: 'Error adding reply', description: error.message })
    },
  })

  const updateComment = api.comment.update.useMutation({
    onSuccess: () => {
      setEditingComment(null)
      setEditContent('')
      refreshComments()
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
      refreshComments()
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
      refreshComments()
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
      refreshComments()
    },
    onError: (error) => {
      toastError({ title: 'Error adding reaction', description: error.message })
    },
  })

  const removeReaction = api.comment.removeReaction.useMutation({
    onSuccess: () => {
      refreshComments()
    },
    onError: (error) => {
      toastError({
        title: 'Error removing reaction',
        description: error.message,
      })
    },
  })

  // Submit new top-level comment
  const handleSubmitComment = () => {
    if (!newComment.trim()) return

    createComment.mutate({ content: newComment, entityId, entityType })
  }

  // Submit a reply to a comment
  const handleSubmitReply = () => {
    if (!replyingTo || !replyContent.trim()) return

    createReply.mutate({
      content: replyContent,
      entityId,
      entityType,
      parentId: replyingTo,
    })
  }

  // Submit an edit to a comment
  const handleSubmitEdit = () => {
    if (!editingComment || !editContent.trim()) return

    updateComment.mutate({ id: editingComment, content: editContent })
  }

  // Start editing a comment
  const handleStartEdit = (comment: Comment) => {
    setEditingComment(comment.id)
    setEditContent(comment.content)
  }

  // Toggle like reaction
  const handleToggleLike = (comment: Comment) => {
    if (comment.reactions.likes.userReacted) {
      removeReaction.mutate({ commentId: comment.id, type: 'like' })
    } else {
      addReaction.mutate({ commentId: comment.id, type: 'like' })
    }
  }

  // Toggle emoji reaction
  const handleToggleEmoji = (comment: Comment, emoji: string) => {
    const hasReacted = comment.reactions.emojis[emoji]?.userReacted

    if (hasReacted) {
      removeReaction.mutate({ commentId: comment.id, type: 'emoji', emoji })
    } else {
      addReaction.mutate({ commentId: comment.id, type: 'emoji', emoji })
    }
  }

  // Add new emoji reaction
  const handleAddEmoji = (comment: Comment, emoji: string) => {
    addReaction.mutate({ commentId: comment.id, type: 'emoji', emoji })
  }

  // Render a single comment
  const renderComment = (comment: Comment, isReply = false) => {
    const isEditing = editingComment === comment.id
    const isReplying = replyingTo === comment.id

    return (
      <div
        key={comment.id}
        className={`p-4 ${isReply ? 'ml-12 mt-2' : 'mb-4'} ${
          comment.isPinned ? 'rounded-lg border border-amber-200 bg-amber-50' : 'border-b'
        }`}>
        {/* Comment header - author, time, and actions */}
        <div className="mb-2 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              {comment.createdBy.image ? (
                <AvatarImage src={comment.createdBy.image} alt={comment.createdBy.name || ''} />
              ) : (
                <AvatarFallback>{comment.createdBy.name?.charAt(0) || '?'}</AvatarFallback>
              )}
            </Avatar>
            <div>
              <div className="font-medium">{comment.createdBy.name || 'Unknown User'}</div>
              <div className="text-xs text-gray-500">
                {format(new Date(comment.createdAt), 'MMM d, yyyy h:mm a')}
                {comment.updatedAt > comment.createdAt && (
                  <span className="ml-2 italic">(edited)</span>
                )}
              </div>
            </div>
            {comment.isPinned && (
              <Tooltip>
                <TooltipTrigger>
                  <div className="ml-2 flex items-center text-xs text-amber-600">
                    <Pin size={12} className="mr-1" />
                    <span>
                      Pinned {comment.pinnedBy?.name ? `by ${comment.pinnedBy.name}` : ''}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Pinned on {format(new Date(comment.pinnedAt!), 'MMM d, yyyy h:mm a')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Comment actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setReplyingTo(comment.id)}>
                  <Reply />
                  Reply
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStartEdit(comment)}>
                  <Pencil />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => togglePin.mutate({ id: comment.id, pin: !comment.isPinned })}>
                  <Pin />
                  {comment.isPinned ? 'Unpin' : 'Pin'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (window.confirm('Are you sure you want to delete this comment?')) {
                      deleteComment.mutate({ id: comment.id })
                    }
                  }}
                  variant="destructive">
                  <Trash />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Comment content */}
        {isEditing ? (
          <div className="mb-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={3}
              className="w-full rounded border p-2"
              placeholder="Edit your comment..."
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={handleSubmitEdit}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingComment(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="mb-4"
            dangerouslySetInnerHTML={{
              __html: formatCommentContent(comment.content, comment.mentions),
            }}
          />
        )}

        {/* Attachments */}
        {comment.files.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {comment.files.map((file) => {
              const fileName = file.mediaAsset.name || 'Unnamed file'
              const fileSize = file.mediaAsset.size ? Number(file.mediaAsset.size) : 0
              // TODO: Generate URL from storageLocation - this will need a utility function
              const fileUrl = '#' // Placeholder until URL generation is implemented

              return (
                <div key={file.id} className="flex items-center rounded border p-2 text-sm">
                  <FileIcon className="mr-2 h-4 w-4" />
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline">
                    {fileName}
                  </a>
                  <span className="ml-2 text-gray-500">({Math.round(fileSize / 1024)}KB)</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Reactions */}
        <div className="mb-4 flex flex-wrap gap-2">
          {/* Like button */}
          <Button
            size="sm"
            variant={comment.reactions.likes.userReacted ? 'default' : 'outline'}
            className="flex h-8 items-center gap-1 py-1"
            onClick={() => handleToggleLike(comment)}>
            <ThumbsUp />
            {comment.reactions.likes.count > 0 && <span>{comment.reactions.likes.count}</span>}
          </Button>

          {/* Emoji reactions */}
          {Object.entries(comment.reactions.emojis).map(([emoji, data]) => (
            <Button
              key={emoji}
              size="sm"
              variant={data.userReacted ? 'default' : 'outline'}
              className="flex h-8 items-center gap-1 py-1"
              onClick={() => handleToggleEmoji(comment, emoji)}>
              <span>{emoji}</span>
              {data.count > 0 && <span>{data.count}</span>}
            </Button>
          ))}

          {/* Emoji picker */}
          <EmojiPicker onEmojiSelect={(emoji) => handleAddEmoji(comment, emoji)} />
        </div>

        {/* Reply form */}
        {isReplying && (
          <div className="mb-2 mt-4">
            <Textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={3}
              className="w-full rounded border p-2"
              placeholder="Write a reply..."
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={handleSubmitReply} disabled={!replyContent.trim()}>
                Reply
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReplyingTo(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Show reply button if not already replying or showing replies */}
        {!isReplying && !isReply && (
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-500"
            onClick={() => setReplyingTo(comment.id)}>
            <Reply />
            Reply
          </Button>
        )}

        {/* Comment replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-4">{comment.replies.map((reply) => renderComment(reply, true))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-white">
      <div className="p-4">
        <h3 className="mb-4 text-lg font-semibold">Comments</h3>

        {/* New comment form */}
        <div className="mb-6">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={3}
            className="w-full rounded border p-2"
            placeholder="Write a comment..."
          />
          <div className="mt-2 flex justify-end">
            <Button
              onClick={handleSubmitComment}
              disabled={!newComment.trim() || createComment.isPending}>
              {createComment.isPending ? 'Posting...' : 'Post Comment'}
            </Button>
          </div>
        </div>

        {/* Comments list */}
        <div>
          {comments.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No comments yet. Be the first to comment!
            </div>
          ) : (
            <div>{comments.map((comment) => renderComment(comment))}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Emoji picker component
// interface EmojiPickerProps {
//   onEmojiSelect: (emoji: string) => void
// }

// export function EmojiPicker({ onEmojiSelect }: EmojiPickerProps) {
//   // Common emojis to show in the dropdown
//   const commonEmojis = [
//     '👍',
//     '👎',
//     '❤️',
//     '😊',
//     '😂',
//     '🎉',
//     '🤔',
//     '👀',
//     '🙌',
//     '👏',
//   ]

//   return (
//     <DropdownMenu>
//       <DropdownMenuTrigger asChild>
//         <Button size='sm' variant='outline' className='h-8'>
//           <span>😊</span>
//         </Button>
//       </DropdownMenuTrigger>
//       <DropdownMenuContent align='start'>
//         <DropdownMenuLabel>Add reaction</DropdownMenuLabel>
//         <DropdownMenuSeparator />
//         <div className='grid grid-cols-5 gap-2 p-2'>
//           {commonEmojis.map((emoji) => (
//             <Button
//               key={emoji}
//               variant='ghost'
//               className='h-8 w-8 p-0'
//               onClick={() => onEmojiSelect(emoji)}>
//               {emoji}
//             </Button>
//           ))}
//         </div>
//       </DropdownMenuContent>
//     </DropdownMenu>
//   )
// }
