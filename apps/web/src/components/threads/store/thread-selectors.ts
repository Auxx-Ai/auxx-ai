// apps/web/src/components/threads/store/thread-selectors.ts

import {
  threadMatchesFilter,
  type ThreadClientFilter,
} from '@auxx/lib/mail-query/client'
import type { ThreadMeta, ThreadSort } from './thread-store'

/** Re-export filter type for convenience */
export type { ThreadClientFilter as ThreadFilter }

/** Default sort: newest first by last message */
const DEFAULT_SORT: ThreadSort = { field: 'lastMessageAt', direction: 'desc' }

/**
 * Create a stable context key for tracking loaded state.
 * Used by useThreadList to track which contexts have been fetched.
 */
export function createContextKey(params: {
  contextType: string
  contextId?: string
  statusSlug?: string
}): string {
  return JSON.stringify({
    t: params.contextType,
    i: params.contextId,
    s: params.statusSlug,
  })
}

/**
 * Sort threads by the specified field and direction.
 * Returns a new sorted array (does not mutate input).
 */
export function sortThreads(threads: ThreadMeta[], sort: ThreadSort): ThreadMeta[] {
  return [...threads].sort((a, b) => {
    let comparison = 0

    switch (sort.field) {
      case 'lastMessageAt':
        comparison = new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
        break
      case 'firstMessageAt':
        comparison =
          new Date(a.firstMessageAt ?? a.lastMessageAt).getTime() -
          new Date(b.firstMessageAt ?? b.lastMessageAt).getTime()
        break
      case 'subject':
        comparison = a.subject.localeCompare(b.subject)
        break
    }

    return sort.direction === 'desc' ? -comparison : comparison
  })
}

/**
 * Filter threads from a Map by criteria using shared utility.
 * Returns filtered array.
 */
export function filterThreadsFromMap(
  threadsMap: Map<string, ThreadMeta>,
  filter: ThreadClientFilter
): ThreadMeta[] {
  const threads: ThreadMeta[] = []
  for (const thread of threadsMap.values()) {
    if (threadMatchesFilter(thread, filter)) {
      threads.push(thread)
    }
  }
  return threads
}

/**
 * Create a selector function for filtered and sorted threads.
 * Use with useThreadStore and useShallow for optimal re-render prevention.
 *
 * @example
 * ```typescript
 * const selectOpenThreads = createThreadSelector({ status: 'OPEN' })
 * const threads = useThreadStore(useShallow(selectOpenThreads))
 * ```
 */
export function createThreadSelector(
  filter: ThreadClientFilter,
  sort: ThreadSort = DEFAULT_SORT
) {
  return (state: { threads: Map<string, ThreadMeta> }): ThreadMeta[] => {
    const filtered = filterThreadsFromMap(state.threads, filter)
    return sortThreads(filtered, sort)
  }
}

/**
 * Create selector for threads in a specific inbox with optional status filter.
 */
export function createInboxThreadsSelector(inboxId: string, status?: ThreadMeta['status']) {
  return createThreadSelector({ inboxId, status }, DEFAULT_SORT)
}

/**
 * Create selector for user's assigned threads with optional status filter.
 */
export function createAssignedThreadsSelector(assigneeActorId: string, status?: ThreadMeta['status']) {
  return createThreadSelector({ assigneeActorId, status }, DEFAULT_SORT)
}

/**
 * Create selector for unread threads with additional filter criteria.
 */
export function createUnreadThreadsSelector(additionalFilter?: ThreadClientFilter) {
  return createThreadSelector({ ...additionalFilter, isUnread: true }, DEFAULT_SORT)
}

/**
 * Get thread IDs from a filtered thread list.
 * Useful when components need IDs rather than full thread objects.
 */
export function getThreadIdsFromSelector(
  state: { threads: Map<string, ThreadMeta> },
  filter: ThreadClientFilter,
  sort: ThreadSort = DEFAULT_SORT
): string[] {
  const selector = createThreadSelector(filter, sort)
  return selector(state).map((t) => t.id)
}
