'use client'
// apps/web/src/components/global/comments/comment-list.tsx
import React from 'react'
import { CommentItem, CommentSkeleton } from './comment-item'
import { useComments, type CommentableEntityType, type Comment } from '~/hooks/use-comments'
import { getGroupPosition, groupConsecutiveComments } from '@auxx/lib/utils'

interface CommentListProps {
  // Required props
  entityId: string
  entityType: CommentableEntityType

  // Optional props
  initialComments?: any[]
  onCommentAdded?: () => void
  className?: string
}

export function CommentList({
  entityId,
  entityType,
  initialComments,
  onCommentAdded,
  className,
}: CommentListProps) {
  // Use the hook directly
  const { comments, isFetchingComments } = useComments({ entityId, entityType, onCommentAdded })

  if (isFetchingComments) {
    return (
      <div className={className}>
        <CommentSkeleton />
        <CommentSkeleton />
      </div>
    )
  }

  // Group consecutive comments from the same sender
  // Type guard to ensure comments have the right structure
  const validComments = comments.filter(
    (c): c is Comment =>
      c && typeof c === 'object' && 'createdBy' in c && c.createdBy && 'id' in c.createdBy
  )
  // Cast to any to handle type mismatch between the two Comment types
  const groups = groupConsecutiveComments(validComments as any)

  return (
    <div className={className}>
      {groups.map((group) => (
        <div key={`${group.sender.id}-${group.startIndex}`}>
          {group.comments.map((comment, idx) => {
            const groupPosition = getGroupPosition(idx, group.comments.length)
            return (
              <CommentItem
                key={comment.id}
                comment={comment as Comment}
                entityId={entityId}
                entityType={entityType}
                isReply={false}
                disableReplies={false}
                isFirstInGroup={idx === 0}
                isLastInGroup={idx === group.comments.length - 1}
                groupPosition={groupPosition}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
