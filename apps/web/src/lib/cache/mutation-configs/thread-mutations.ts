// apps/web/src/lib/cache/mutation-configs/thread-mutations.ts

/**
 * Declarative configuration for thread mutations
 * Defines how each mutation should behave optimistically
 */

export interface ThreadMutationConfig<TVariables = any> {
  /**
   * Generate optimistic data based on mutation variables
   */
  getOptimisticData: (variables: TVariables, currentThread?: any) => any

  /**
   * Determine if this mutation moves threads between lists
   */
  movesBetweenLists?: boolean

  /**
   * Define list movements for mutations that change thread categorization
   */
  getListMovement?: (
    variables: TVariables,
    currentThread?: any
  ) => {
    from: {
      statusSlug?: string | string[]
      contextType?: string
      contextId?: string
    }
    to: {
      statusSlug?: string | string[]
      contextType?: string
      contextId?: string
    }
  }

  /**
   * Conditional list movements based on thread state
   */
  conditionalMovement?: (
    variables: TVariables,
    currentThread?: any
  ) => {
    remove?: string[]
    add?: string[]
  }

  /**
   * Side effects to execute (e.g., update counts, send notifications)
   */
  sideEffects?: Array<'updateUnreadCount' | 'updateThreadCounts' | 'invalidateDetails'>

  /**
   * Success handler
   */
  onSuccess?: (data: any, variables: TVariables) => void

  /**
   * Error handler
   */
  onError?: (error: Error, variables: TVariables) => void
}

/**
 * Predefined configurations for all thread mutations
 */
export const threadMutationConfigs = {
  /**
   * Archive thread - moves from open/assigned/unassigned to done
   */
  archive: {
    getOptimisticData: () => ({
      status: 'ARCHIVED',
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: () => ({
      from: { statusSlug: ['open', 'assigned', 'unassigned'] },
      to: { statusSlug: 'done' },
    }),
    sideEffects: ['updateUnreadCount', 'updateThreadCounts'],
  } as ThreadMutationConfig<{ threadId: string }>,

  /**
   * Unarchive thread - moves from done back to appropriate list
   */
  unarchive: {
    getOptimisticData: () => ({
      status: 'ACTIVE',
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: (variables, currentThread) => ({
      from: { statusSlug: 'done' },
      to: {
        statusSlug: currentThread?.assigneeId ? 'assigned' : 'open',
      },
    }),
    sideEffects: ['updateUnreadCount', 'updateThreadCounts'],
  } as ThreadMutationConfig<{ threadId: string }>,

  /**
   * Move to trash - removes from all active lists
   */
  moveToTrash: {
    getOptimisticData: () => ({
      status: 'TRASHED',
      trashedAt: new Date(),
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: () => ({
      from: { statusSlug: ['open', 'done', 'assigned', 'unassigned'] },
      to: { statusSlug: 'trash' },
    }),
    sideEffects: ['updateUnreadCount', 'updateThreadCounts'],
  } as ThreadMutationConfig<{ threadId: string }>,

  /**
   * Restore from trash - moves back to appropriate list
   */
  restoreFromTrash: {
    getOptimisticData: () => ({
      status: 'ACTIVE',
      trashedAt: null,
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: (variables, currentThread) => ({
      from: { statusSlug: 'trash' },
      to: {
        statusSlug: currentThread?.assigneeId ? 'assigned' : 'open',
      },
    }),
    sideEffects: ['updateUnreadCount', 'updateThreadCounts'],
  } as ThreadMutationConfig<{ threadId: string }>,

  /**
   * Bulk move to trash - handles multiple threads
   */
  moveToTrashBulk: {
    getOptimisticData: () => ({
      status: 'TRASHED',
      trashedAt: new Date(),
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: () => ({
      from: { statusSlug: ['open', 'done', 'assigned', 'unassigned'] },
      to: { statusSlug: 'trash' },
    }),
    sideEffects: ['updateUnreadCount', 'updateThreadCounts'],
  } as ThreadMutationConfig<{ threadIds: string[] }>,

  /**
   * Update assignee - may move between assigned/unassigned lists
   */
  updateAssignee: {
    getOptimisticData: (variables: { threadId: string; assigneeId: string | null }) => ({
      assigneeId: variables.assigneeId,
      assignee: variables.assigneeId ? { id: variables.assigneeId } : null,
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: (variables, currentThread) => {
      const wasAssigned = !!currentThread?.assigneeId
      const willBeAssigned = !!variables.assigneeId

      if (wasAssigned && !willBeAssigned) {
        return {
          from: { statusSlug: 'assigned' },
          to: { statusSlug: 'unassigned' },
        }
      } else if (!wasAssigned && willBeAssigned) {
        return {
          from: { statusSlug: 'unassigned' },
          to: { statusSlug: 'assigned' },
        }
      }

      // No movement needed
      return { from: {}, to: {} }
    },
  } as ThreadMutationConfig<{ threadId: string; assigneeId: string | null }>,

  /**
   * Update subject - in-place update only
   */
  updateSubject: {
    getOptimisticData: (variables: { threadId: string; subject: string }) => ({
      subject: variables.subject,
      updatedAt: new Date(),
    }),
    sideEffects: ['invalidateDetails'],
  } as ThreadMutationConfig<{ threadId: string; subject: string }>,

  /**
   * Update tags - in-place update only
   */
  updateTags: {
    getOptimisticData: (variables: { threadId: string; tagIds: string[] }) => ({
      tags: variables.tagIds.map((id) => ({
        tag: { id, title: 'Loading...', color: '#gray' },
      })),
      updatedAt: new Date(),
    }),
  } as ThreadMutationConfig<{ threadId: string; tagIds: string[] }>,

  /**
   * Mark as read - updates read status
   */
  markAsRead: {
    getOptimisticData: () => ({
      isRead: true,
      readAt: new Date(),
      updatedAt: new Date(),
    }),
    sideEffects: ['updateUnreadCount'],
  } as ThreadMutationConfig<{ threadId: string }>,

  /**
   * Mark as unread - updates read status
   */
  markAsUnread: {
    getOptimisticData: () => ({
      isRead: false,
      readAt: null,
      updatedAt: new Date(),
    }),
    sideEffects: ['updateUnreadCount'],
  } as ThreadMutationConfig<{ threadId: string }>,

  /**
   * Move to inbox - changes inbox assignment
   */
  moveToInbox: {
    getOptimisticData: (variables: { threadId: string; inboxId: string }) => ({
      inboxId: variables.inboxId,
      inbox: { id: variables.inboxId }, // Minimal inbox data
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: (variables, currentThread) => ({
      from: {
        contextType: 'specific_inbox',
        contextId: currentThread?.inboxId,
      },
      to: {
        contextType: 'specific_inbox',
        contextId: variables.inboxId,
      },
    }),
  } as ThreadMutationConfig<{ threadId: string; inboxId: string }>,

  /**
   * Bulk move to inbox - handles multiple threads
   */
  moveBulkToInbox: {
    getOptimisticData: (variables: { threadIds: string[]; targetInboxId: string }) => ({
      inboxId: variables.targetInboxId,
      inbox: { id: variables.targetInboxId },
      updatedAt: new Date(),
    }),
    movesBetweenLists: true,
    getListMovement: (variables) => ({
      from: { contextType: 'specific_inbox' }, // Will be filtered per thread
      to: {
        contextType: 'specific_inbox',
        contextId: variables.targetInboxId,
      },
    }),
  } as ThreadMutationConfig<{ threadIds: string[]; targetInboxId: string }>,

  /**
   * Update priority - in-place update
   */
  updatePriority: {
    getOptimisticData: (variables: { threadId: string; priority: string }) => ({
      priority: variables.priority,
      updatedAt: new Date(),
    }),
  } as ThreadMutationConfig<{ threadId: string; priority: string }>,
} as const

/**
 * Helper to get mutation config by name
 */
export function getThreadMutationConfig(
  mutationName: keyof typeof threadMutationConfigs
): ThreadMutationConfig {
  return threadMutationConfigs[mutationName]
}

/**
 * Type for thread mutation names
 */
export type ThreadMutationName = keyof typeof threadMutationConfigs
