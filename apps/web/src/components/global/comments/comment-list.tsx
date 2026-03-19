'use client'
import type { RecordId } from '@auxx/lib/field-values/client'
import { getGroupPosition, groupConsecutiveComments } from '@auxx/utils'
import { type Comment, useComments } from '~/hooks/use-comments'
import { CommentItem, CommentSkeleton } from './comment-item'

interface CommentListProps {
  // Required props
  recordId: RecordId

  // Optional props
  initialComments?: any[]
  onCommentAdded?: () => void
  className?: string
}

export function CommentList({
  recordId,
  initialComments,
  onCommentAdded,
  className,
}: CommentListProps) {
  // Use the hook directly
  const { comments, isFetchingComments } = useComments({ recordId, onCommentAdded })

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
    (c): c is Comment => c && typeof c === 'object' && 'actorId' in c && !!c.actorId
  )
  // Cast to any to handle type mismatch between the two Comment types
  const groups = groupConsecutiveComments(validComments as any)

  return (
    <div className={className}>
      {groups.map((group) => (
        <div key={`${group.senderId}-${group.startIndex}`}>
          {group.comments.map((comment, idx) => {
            const groupPosition = getGroupPosition(idx, group.comments.length)
            return (
              <CommentItem
                key={comment.id}
                comment={comment as Comment}
                recordId={recordId}
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
