// --- START OF FILE @auxx/lib/email/filter-types.ts ---

// Statuses derived from URL slugs - used in tRPC input
export enum UrlBasedStatusFilter {
  OPEN = 'open',
  DONE = 'done', // Includes resolved
  TRASH = 'trash', // Renamed from trashed for consistency
  SPAM = 'spam',
  ASSIGNED = 'assigned', // Context determines if ME or ANY
  UNASSIGNED = 'unassigned',
  DRAFTS = 'drafts', // Special case
  SENT = 'sent', // Special case
  ALL = 'all', // Usually means "all non-trash/spam"
  SNOOZED = 'snoozed', // Placeholder - requires implementation
}

// Backend internal representation (similar to SimpleFilterType, but maybe more granular)
// Let's stick with SimpleFilterType for now and add ASSIGNED_ANY
// export { SimpleFilterType } from './mail-query-builder' // Re-export for convenience

// Helper function (can stay in utils or move here)
export function mapUrlSlugToStatusFilter(
  slug: string | undefined
): UrlBasedStatusFilter | undefined {
  const lowerSlug = slug?.toLowerCase()
  switch (lowerSlug) {
    case 'open':
      return UrlBasedStatusFilter.OPEN
    case 'done':
    case 'resolved':
    case 'archived': // Alias used by IsOperatorValue in searchbar
      return UrlBasedStatusFilter.DONE
    case 'trashed': // Accept 'trashed' from URL
    case 'trash':
      return UrlBasedStatusFilter.TRASH
    case 'spam':
      return UrlBasedStatusFilter.SPAM
    case 'assigned':
      return UrlBasedStatusFilter.ASSIGNED
    case 'unassigned':
      return UrlBasedStatusFilter.UNASSIGNED
    case 'drafts':
      return UrlBasedStatusFilter.DRAFTS
    case 'sent':
      return UrlBasedStatusFilter.SENT
    case 'all':
      return UrlBasedStatusFilter.ALL
    case 'snoozed':
      return UrlBasedStatusFilter.SNOOZED // Map even if not implemented
    default:
      return undefined // Explicitly handle unknown slugs
  }
}
