'use client'
// components/comments/comment-item.tsx
import React from 'react'
import { format } from 'date-fns'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Reply, Pin, Trash, Pencil, PinOff, SmilePlus, X } from 'lucide-react'
import { EmojiPicker } from '~/components/pickers/emoji-picker'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useComments, type Comment as CommentType } from '~/hooks/use-comments'
import { formatRelativeTime, getInitialsFromName } from '@auxx/utils'
import { useConfirm } from '~/hooks/use-confirm'
import { Tooltip } from '../tooltip'
import CommentComposer from './comment-composer'
import { Badge } from '@auxx/ui/components/badge'
import { AttachmentDisplay } from '~/components/files/utils/attachment-display'
import { useActor } from '~/components/resources/hooks/use-actor'
import type { ActorId } from '@auxx/types/actor'

import { cn } from '@auxx/ui/lib/utils'
import type { RecordId } from '@auxx/lib/field-values/client'

/** Helper to convert userId to ActorId format */
const toUserActorId = (userId: string): ActorId => `user:${userId}` as ActorId

interface CommentItemProps {
  comment?: CommentType
  commentId?: string
  recordId?: RecordId
  isReply?: boolean
  disableReplies?: boolean
  isFirstInGroup?: boolean // Show avatar and name
  isLastInGroup?: boolean // Add bottom spacing
  groupPosition?: 'first' | 'middle' | 'last' | 'single'
  // className?: string
}

// Loading skeleton for comments
export const CommentSkeleton = () => (
  <div className="pb-4 ps-3">
    <div className="flex items-start gap-3">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex-1">
        <Skeleton className="mb-1 h-4 w-[16rem]" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  </div>
)

export function CommentItem({
  comment: initialComment,
  commentId,
  recordId,
  isReply = false,
  disableReplies = false,
  isFirstInGroup = true,
  isLastInGroup = true,
  groupPosition = 'single',
  // className = '',
}: CommentItemProps) {
  // Use our custom hook
  const [confirm, ConfirmDialog] = useConfirm()
  const {
    isFetchingComments,
    editingCommentId,
    setEditingCommentId,
    replyingToId,
    setReplyingToId,
    handleToggleEmoji,
    handleAddEmoji,
    handleTogglePin,
    handleDeleteComment,
    formatContent,
    isUpdating,
    deletingCommentId,
    pinningCommentId,
    addingEmojiToCommentId,
  } = useComments({ commentId, recordId })

  // Use either the provided comment or the fetched single comment
  // const comment = initialComment || singleComment
  const comment = initialComment

  // Use actor hooks to resolve creator and pinner info
  const { actor: creator } = useActor({
    actorId: comment?.createdById ? toUserActorId(comment.createdById) : null,
    enabled: !!comment?.createdById,
  })
  const { actor: pinner } = useActor({
    actorId: comment?.pinnedById ? toUserActorId(comment.pinnedById) : null,
    enabled: !!comment?.pinnedById,
  })

  // Show loading state if we're fetching and don't have a comment yet
  if (isFetchingComments && !comment) {
    return <CommentSkeleton />
  }

  // If we still don't have a comment after loading, show error
  if (!comment) {
    return (
      <div className="p-4 text-center text-gray-500">
        Comment not found or you don't have access.
      </div>
    )
  }

  const handleDeleteWithConfirmation = async () => {
    const confirmed = await confirm({
      title: 'Delete comment?',
      description: 'Are you sure you want to delete this comment? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      handleDeleteComment(comment.id)
    }
  }
  const isEditing = editingCommentId === comment.id
  const isReplying = replyingToId === comment.id
  return (
    <>
      <div
        className={cn('group/comment items-center justify-items-start gap-x-2', {
          'ms-8': !!comment.parentId,
          'mt-4': !groupPosition || groupPosition === 'single' || groupPosition === 'first',
          'mt-1': groupPosition === 'middle' || groupPosition === 'last',
        })}>
        <div className="col-span-3 row-start-1 grid w-full grid-cols-[30px_auto_minmax(30%,1fr)] items-center justify-items-start gap-x-2">
          <div className="col-span-3 row-start-1 flex flex-col">
            <div className="relative mb-1 mt-[3px] grid grid-cols-[16px_auto] items-center gap-x-[5px] pl-7 leading-4 first:mt-0">
              {!comment.parentId && isFirstInGroup && (
                <div className="col-start-2 text-[11px] font-semibold text-primary-400">
                  <div className="inline-block">
                    <span className="">{creator?.name}</span>
                  </div>
                </div>
              )}
              <div className="col-start-2 text-[11px] font-semibold">
                {comment?.isPinned && (
                  <Tooltip
                    content={`Pinned on ${format(new Date(comment.pinnedAt!), 'MMM d, yyyy h:mm a')}`}>
                    <div className="flex items-center text-xs text-amber-600">
                      <Pin size={12} className="mr-1" />
                      <span>
                        Pinned {pinner?.name ? `by ${pinner.name}` : ''}
                      </span>
                    </div>
                  </Tooltip>
                )}
              </div>
              <div className="col-start-2 text-[11px] font-semibold ">
                {comment.parentId && (
                  <div className="flex items-center text-xs text-primary-400">
                    <Reply size={12} className="mr-1" />
                    <span>{creator?.name} replied</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="col-start-1 row-start-2">
            {isFirstInGroup ? (
              <Avatar className="size-8">
                <AvatarImage
                  src={creator?.avatarUrl || undefined}
                  alt={creator?.name || ''}
                />
                <AvatarFallback className="bg-primary-200 text-background">
                  {getInitialsFromName(creator?.name || null)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="size-8" /> // Empty space for alignment
            )}
          </div>
          {/* col-start-2: Positions this element to start at the second column in
          the grid row-span-2: Makes this element span across 2 rows vertically
          row-start-2: Positions this element to start at the second row in the
          grid */}
          <div className="col-start-2 row-span-2 row-start-2 grid w-full break-words">
            {isEditing && (
              <div className="mb-4 w-[400px]">
                <CommentComposer
                  recordId={recordId!}
                  commentId={comment.id}
                  initialContent={comment.content}
                  initialAttachments={comment.attachments || []}
                  onSubmitted={
                    () => {
                      setEditingCommentId(null)
                    }
                    // handleUpdateComment(comment.id, content)
                  }
                  expanded
                  autoFocus
                  onCancel={() => setEditingCommentId(null)}
                />
              </div>
            )}
            {!isEditing && (
              <>
                <div className="block h-full w-fit max-w-full rounded-[15px] bg-primary-200 text-sm font-normal text-foreground">
                  <div className="cursor-text select-text px-3 py-1 leading-[22px]">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: formatContent(comment.content, comment.mentions),
                      }}
                    />
                  </div>

                  {/* Attachment display with download functionality */}
                  {comment.attachments && comment.attachments.length > 0 && (
                    <div className="flex flex-col gap-2 px-2 pb-2">
                      {comment.attachments.map((attachment) => (
                        <AttachmentDisplay
                          key={attachment.id}
                          attachment={attachment}
                          showRemoveButton={false} // No remove in read-only comment view
                        />
                      ))}
                    </div>
                  )}

                  {/* Emoji reactions */}
                  {comment.reactions.emojis && Object.keys(comment.reactions.emojis).length > 0 && (
                    <div className="px-2 pb-1 flex flex-row items-center gap-1">
                      {Object.entries(comment.reactions.emojis).map(([emoji, data]) => (
                        <Badge
                          key={emoji}
                          variant="outline"
                          className="flex cursor-pointer gap-1 rounded-lg bg-primary-300 border-0 hover:bg-info/80 hover:text-info-foreground"
                          onClick={() => handleToggleEmoji(comment.id, emoji, data.userReacted)}>
                          <span>{emoji}</span>
                          {data.count > 0 && <span>{data.count}</span>}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="col-start-3 row-start-2 ml-px flex w-full min-w-0">
            {!isEditing && (
              <div
                className={cn(
                  'flex items-center',
                  'invisible group-hover/comment:visible',
                  // Keep visible when any action is in progress for this comment or when replying
                  (isUpdating(comment.id) || isReplying) && 'visible'
                )}>
                <div className="min-w-0">
                  <EmojiPicker onChange={(emoji) => handleAddEmoji(comment.id, emoji)}>
                    <Button
                      variant={'ghost'}
                      size="icon"
                      className="size-7 rounded-full p-0 hover:bg-foreground/10"
                      loading={addingEmojiToCommentId === comment.id}
                      disabled={addingEmojiToCommentId === comment.id}>
                      <SmilePlus />
                    </Button>
                  </EmojiPicker>
                </div>

                <div className="min-w-0">
                  <Button
                    variant={'ghost'}
                    size="icon"
                    className="size-7 rounded-full p-0 hover:bg-foreground/10"
                    onClick={() => handleTogglePin(comment.id, comment.isPinned)}
                    loading={pinningCommentId === comment.id}
                    disabled={pinningCommentId === comment.id}>
                    {comment.isPinned ? <PinOff /> : <Pin />}
                  </Button>
                </div>
                <div className="min-w-0">
                  <Button
                    variant={'ghost'}
                    size="icon"
                    className={cn(
                      'size-7 rounded-full p-0 hover:bg-foreground/10',
                      isReplying && 'bg-bad-100 hover:bg-bad-200 text-bad-500 hover:text-bad-600'
                    )}
                    onClick={() => setReplyingToId(isReplying ? null : comment.id)}>
                    {isReplying ? <X /> : <Reply />}
                  </Button>
                </div>
                <div className="min-w-0">
                  <Button
                    variant={'ghost'}
                    size="icon"
                    className="size-7 rounded-full p-0 hover:bg-foreground/10"
                    onClick={() => setEditingCommentId(comment.id)}>
                    <Pencil />
                  </Button>
                </div>
                <div className="min-w-0">
                  <Button
                    variant={'ghost'}
                    size="icon"
                    className="size-7 rounded-full p-0 hover:bg-foreground/10"
                    onClick={handleDeleteWithConfirmation}
                    loading={deletingCommentId === comment.id}
                    disabled={deletingCommentId === comment.id}>
                    <Trash />
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-1 justify-end overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[30px]  opacity-100">
              <div className="ml-[6px] mr-[5px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">
                    {comment.updatedAt > comment.createdAt && (
                      <span className="ml-2 mr-1 italic">(edited)</span>
                    )}

                    <span className="uppercase">{formatRelativeTime(comment.createdAt, true)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reply composer - appears below comment when replying */}
      {isReplying && !disableReplies && (
        <div className="ms-8 mt-2 mb-2 max-w-[400px]">
          <CommentComposer
            recordId={recordId!}
            parentId={comment.id}
            placeholder="Write a reply..."
            onSubmitted={() => setReplyingToId(null)}
            onCancel={() => setReplyingToId(null)}
            autoFocus
          />
        </div>
      )}

      {/* Comment replies */}
      {comment.replies && comment.replies.length > 0 && !disableReplies && (
        <div className="">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              recordId={recordId}
              isReply={true}
              disableReplies={true} // Disallow nested replies
            />
          ))}
        </div>
      )}
      <ConfirmDialog />
    </>
  )
}
