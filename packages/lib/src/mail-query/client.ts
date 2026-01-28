// packages/lib/src/mail-query/client.ts

export { SearchOperator, IsOperatorValue, parseSearchQuery, type SearchToken } from './search-query-parser'

// Structured search filters for the searchbar
export {
  type FilterRef,
  type SearchFilters,
  type ApiSearchFilter,
  type SearchCondition,
  hasActiveFilters,
  filtersToApiFilter,
  conditionsToApiFilter,
  hasActiveConditions,
} from './search-filters'

// ═══════════════════════════════════════════════════════════════════════════
// Thread Client Filter Types and Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supported thread status values.
 * Matches ThreadStatus enum from @auxx/database/enums
 */
type ThreadStatusValue = 'OPEN' | 'ARCHIVED' | 'TRASH' | 'SPAM'

/**
 * Client-side thread filter criteria.
 * Used by frontend selectors to derive views from the thread store.
 *
 * Design notes:
 * - Mirrors server-side `buildStatusCondition()` logic for consistency
 * - Uses plain values (no SQL), enabling in-memory filtering
 * - Generic enough to work with any object having the required fields
 */
export interface ThreadClientFilter {
  /** Filter by thread status (OPEN, ARCHIVED, TRASH, SPAM) */
  status?: ThreadStatusValue | ThreadStatusValue[]

  /** Filter by inbox ID */
  inboxId?: string

  /** Filter by assignment presence: true = has assignee, false = unassigned */
  hasAssignee?: boolean

  /** Filter by specific assignee actor ID */
  assigneeActorId?: string | null

  /** Filter by unread status */
  isUnread?: boolean

  /** Filter by tag IDs (thread must have at least one matching tag) */
  tagIds?: string[]

  /** Exclude specific thread IDs (e.g., during delete animations) */
  excludeIds?: Set<string>
}

/**
 * Maps URL status slugs to client-side filter criteria.
 *
 * This function mirrors the server-side `buildStatusCondition()` in
 * mail-query-builder.ts (lines 425-485) to ensure client optimistic
 * updates match server query behavior.
 *
 * Key behavior (from server):
 * - 'assigned' and 'unassigned' include `status: OPEN` (lines 447-453)
 * - 'drafts' and 'sent' are context-based, not status-based (lines 464-468)
 *
 * @param slug - URL status slug (e.g., 'open', 'done', 'assigned')
 * @returns Partial filter to merge with context filters
 *
 * @example
 * ```typescript
 * const filter = mapStatusSlugToClientFilter('assigned')
 * // Returns: { hasAssignee: true, status: 'OPEN' }
 * ```
 */
export function mapStatusSlugToClientFilter(slug?: string): Partial<ThreadClientFilter> {
  switch (slug?.toLowerCase()) {
    // ─────────────────────────────────────────────────────────────────
    // Status-based filters (direct status mapping)
    // ─────────────────────────────────────────────────────────────────
    case 'open':
      return { status: 'OPEN' }

    case 'done':
    case 'resolved':
      return { status: 'ARCHIVED' }

    case 'trash':
    case 'trashed':
      return { status: 'TRASH' }

    case 'spam':
      return { status: 'SPAM' }

    // ─────────────────────────────────────────────────────────────────
    // Assignment filters (combined with OPEN status)
    // Mirrors server: lines 447-453 in mail-query-builder.ts
    // ─────────────────────────────────────────────────────────────────
    case 'assigned':
      return { hasAssignee: true, status: 'OPEN' }

    case 'unassigned':
      return { hasAssignee: false, status: 'OPEN' }

    // ─────────────────────────────────────────────────────────────────
    // Context-based or no filter needed
    // These are handled by contextType, not status filter
    // ─────────────────────────────────────────────────────────────────
    case 'drafts':
    case 'sent':
    case 'all':
    case 'snoozed':
    default:
      return {}
  }
}

/**
 * Minimal thread shape required for filtering.
 * Generic enough to work with both:
 * - `ThreadMeta` from `packages/lib/src/threads/types.ts`
 * - `ThreadMeta` from `apps/web/src/components/threads/store/thread-store.ts`
 */
export interface FilterableThread {
  id: string
  status: string
  assigneeActorId: { id: string } | string | null
  isUnread?: boolean
  tags?: Array<{ id: string }>
  inboxId?: string | null
}

/**
 * Check if a thread matches the given filter criteria.
 *
 * Used by client-side selectors to derive views from the thread store.
 * All criteria are ANDed together - thread must match all specified filters.
 *
 * @param thread - Thread object with required filter fields
 * @param filter - Filter criteria to check against
 * @returns true if thread matches all filter criteria
 *
 * @example
 * ```typescript
 * const openUnassigned = threadMatchesFilter(thread, {
 *   status: 'OPEN',
 *   hasAssignee: false
 * })
 * ```
 */
export function threadMatchesFilter(thread: FilterableThread, filter: ThreadClientFilter): boolean {
  // ─────────────────────────────────────────────────────────────────
  // Status filter
  // ─────────────────────────────────────────────────────────────────
  if (filter.status !== undefined) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
    if (!statuses.includes(thread.status as ThreadStatusValue)) {
      return false
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Inbox filter
  // ─────────────────────────────────────────────────────────────────
  if (filter.inboxId !== undefined) {
    if (thread.inboxId !== filter.inboxId) {
      return false
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Assignment presence filter (for assigned/unassigned slugs)
  // ─────────────────────────────────────────────────────────────────
  if (filter.hasAssignee !== undefined) {
    const hasAssignee = thread.assigneeActorId !== null
    if (filter.hasAssignee !== hasAssignee) {
      return false
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Specific assignee filter (for personal_assigned context)
  // Handles both ActorId object and string ID formats
  // ─────────────────────────────────────────────────────────────────
  if (filter.assigneeActorId !== undefined) {
    if (filter.assigneeActorId === null) {
      // Filter for unassigned threads
      if (thread.assigneeActorId !== null) {
        return false
      }
    } else {
      // Filter for specific assignee
      const threadAssigneeId =
        typeof thread.assigneeActorId === 'object'
          ? thread.assigneeActorId?.id
          : thread.assigneeActorId
      if (threadAssigneeId !== filter.assigneeActorId) {
        return false
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Unread filter
  // ─────────────────────────────────────────────────────────────────
  if (filter.isUnread !== undefined) {
    if (thread.isUnread !== filter.isUnread) {
      return false
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Tag filter (thread must have at least one matching tag)
  // ─────────────────────────────────────────────────────────────────
  if (filter.tagIds?.length) {
    const threadTagIds = thread.tags?.map((t) => t.id) ?? []
    const hasMatchingTag = filter.tagIds.some((id) => threadTagIds.includes(id))
    if (!hasMatchingTag) {
      return false
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Exclude filter (for hiding during animations)
  // ─────────────────────────────────────────────────────────────────
  if (filter.excludeIds?.has(thread.id)) {
    return false
  }

  return true
}

/**
 * Filter an array of threads by criteria.
 * Convenience wrapper around threadMatchesFilter.
 *
 * @param threads - Array of threads to filter
 * @param filter - Filter criteria
 * @returns Filtered array of threads
 */
export function filterThreads<T extends FilterableThread>(threads: T[], filter: ThreadClientFilter): T[] {
  return threads.filter((thread) => threadMatchesFilter(thread, filter))
}
