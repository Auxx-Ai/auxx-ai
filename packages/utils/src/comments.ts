// packages/lib/src/utils/comments.ts

// Generic comment type that works with any comment structure
// as long as it has the minimum required fields for grouping
export type Comment = {
  id: string
  content: string
  createdAt: Date
  updatedAt: Date
  actorId: string
  isPinned: boolean
  pinnedById?: string | null
  pinnedAt?: Date | null
  parentId?: string | null
  files?: any[] // Optional to support different comment structures
  mentions?: any[] // Optional to support different comment structures
  reactions?: any // Optional to support different comment structures
  [key: string]: any // For other fields we don't need for grouping
}

/**
 * Represents a group of consecutive comments from the same sender
 */
export interface CommentGroup {
  senderId: string
  comments: Comment[]
  startIndex: number // For maintaining original order
}

/**
 * Groups consecutive comments from the same sender
 * Maintains the original order from backend (pinned first, then newest first)
 * @param comments - Array of comments to group
 * @returns Array of comment groups
 */
export function groupConsecutiveComments(comments: Comment[]): CommentGroup[] {
  const groups: CommentGroup[] = []

  comments.forEach((comment, index) => {
    const lastGroup = groups[groups.length - 1]

    // Conditions to start a new group:
    // 1. First comment
    // 2. Different sender
    // 3. Comment is pinned (pinned comments always start a new group for visibility)
    // 4. Comment is a reply (replies break grouping)
    const shouldStartNewGroup =
      !lastGroup ||
      lastGroup.senderId !== comment.actorId ||
      comment.isPinned ||
      comment.parentId !== null

    if (shouldStartNewGroup) {
      // Start a new group
      groups.push({
        senderId: comment.actorId,
        comments: [comment],
        startIndex: index,
      })
    } else {
      // Add to existing group
      lastGroup.comments.push(comment)
    }
  })

  return groups
}

/**
 * Determines the position of a comment within its group
 * @param index - Index of the comment within the group
 * @param groupLength - Total number of comments in the group
 * @returns Position type: 'single', 'first', 'middle', or 'last'
 */
export function getGroupPosition(
  index: number,
  groupLength: number
): 'single' | 'first' | 'middle' | 'last' {
  if (groupLength === 1) return 'single'
  if (index === 0) return 'first'
  if (index === groupLength - 1) return 'last'
  return 'middle'
}
