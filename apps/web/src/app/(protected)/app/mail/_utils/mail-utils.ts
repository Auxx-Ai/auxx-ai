import { type StatusSlug, VALID_STATUS_SLUGS } from '~/components/mail/types'

/**
 * Validates if a string is a valid StatusSlug
 * @param slug - String to validate
 * @returns true if valid StatusSlug, false otherwise
 */
export function isValidStatusSlug(slug: string): slug is StatusSlug {
  return (VALID_STATUS_SLUGS as readonly string[]).includes(slug)
}

/**
 * Safely converts a string to StatusSlug with fallback
 * @param slug - String to convert
 * @param fallback - Fallback StatusSlug if conversion fails
 * @returns Valid StatusSlug
 */
export function toStatusSlug(slug: string | undefined, fallback: StatusSlug = 'open'): StatusSlug {
  if (!slug) return fallback

  // Handle alias
  if (slug === 'resolved') return 'done'

  return isValidStatusSlug(slug) ? slug : fallback
}

/**
 * Result of parsing mailbox context from URL pathname
 */
export interface MailboxContext {
  contextType: string
  contextId?: string
  statusSlug?: StatusSlug
}

/**
 * Parses the URL pathname to extract mailbox context information
 * @param pathname - The current URL pathname
 * @returns MailboxContext object with contextType, contextId, and statusSlug
 */
export function parseMailboxContext(pathname: string): MailboxContext {
  const pathSegments = pathname.split('/')

  // Find status slug from path (search from end)
  let slugFromPath = pathSegments
    .slice() // Create a copy before reversing
    .reverse()
    .find((seg) => isValidStatusSlug(seg))

  // Handle alias
  if (slugFromPath === 'resolved') slugFromPath = 'done'

  let contextType = ''
  let contextId = ''

  // Parse context type based on path segment at index 3
  switch (pathSegments[3]) {
    case 'inbox':
      contextType = 'personal_inbox'
      break
    case 'assigned':
      contextType = 'personal_assigned'
      break
    case 'drafts':
      contextType = 'drafts'
      break
    case 'sent':
      contextType = 'sent'
      break
    case 'tag':
      contextType = 'tag'
      contextId = pathSegments[4] // Tag ID from path
      break
    case 'view':
      contextType = 'view'
      contextId = pathSegments[4] // View ID from path
      break
    case 'inboxes':
      if (pathSegments[4] === 'all') {
        contextType = 'all_inboxes'
      } else {
        contextType = 'specific_inbox'
        contextId = pathSegments[4] // Inbox ID from path
      }
      break
    default:
      // Fallback for unknown context types
      contextType = 'personal_inbox'
  }

  return { contextType, contextId, statusSlug: slugFromPath }
}

/**
 * Derives the active status slug from pathname with fallback logic
 * @param pathname - Current URL pathname
 * @param initialStatusSlug - Fallback status slug
 * @returns Valid StatusSlug
 */
export function deriveActiveStatusSlug(
  pathname: string,
  initialStatusSlug: string = 'open'
): StatusSlug {
  const { statusSlug } = parseMailboxContext(pathname)

  return toStatusSlug(statusSlug, toStatusSlug(initialStatusSlug, 'open'))
}

/**
 * Constructs a new path for tab navigation
 * @param currentPathname - Current URL pathname
 * @param newStatusSlug - New status slug to navigate to
 * @param selectedThreadId - Currently selected thread ID (will be cleared)
 * @returns New pathname for navigation
 */
export function constructTabNavigationPath(
  currentPathname: string,
  newStatusSlug: string,
  selectedThreadId?: string | null
): string {
  const currentSegments = currentPathname.split('/')
  let basePathSegments = [...currentSegments]
  let statusOrThreadIndex = -1

  // Search backwards for the status slug or the selected thread ID
  for (let i = basePathSegments.length - 1; i >= 0; i--) {
    const segment = basePathSegments[i]
    if (isValidStatusSlug(segment)) {
      statusOrThreadIndex = i
      break
    }
    if (selectedThreadId && segment === selectedThreadId) {
      statusOrThreadIndex = i
      break
    }
  }

  // If a status/thread segment was found, slice the array up to that point
  if (statusOrThreadIndex !== -1) {
    basePathSegments = basePathSegments.slice(0, statusOrThreadIndex)
  }

  // Handle root path case
  const base =
    basePathSegments.length <= 1 && basePathSegments[0] === '' ? '' : basePathSegments.join('/')

  return `${base}/${newStatusSlug}`
}

/**
 * Calculates the base path for thread list navigation
 * @param pathname - Current URL pathname
 * @param selectedThreadId - Currently selected thread ID
 * @returns Base path without thread ID
 */
export function calculateBasePathForList(
  pathname: string,
  selectedThreadId?: string | null
): string {
  // If a thread is selected, the current pathname includes the thread ID.
  // We need the path *before* the thread ID.
  if (selectedThreadId && pathname.endsWith('/' + selectedThreadId)) {
    return pathname.substring(0, pathname.lastIndexOf('/'))
  }

  // If no thread is selected, the current pathname is already the base path
  // Remove trailing slash if present for consistency.
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

/**
 * Formats a status slug for display (capitalize and replace hyphens)
 * @param slug - Status slug to format
 * @returns Formatted display string
 */
export function formatStatusSlugForDisplay(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace('-', ' ')
}

/**
 * Constructs search parameters for navigation, preserving some and removing others
 * @param currentSearchParams - Current URLSearchParams
 * @param options - Options for which params to preserve/remove
 * @returns New URLSearchParams object
 */
export function constructNavigationSearchParams(
  currentSearchParams: URLSearchParams | null,
  options: { removeThread?: boolean; preserveQuery?: boolean; newQuery?: string } = {}
): URLSearchParams {
  const newSearchParams = new URLSearchParams(currentSearchParams?.toString())

  if (options.removeThread) {
    newSearchParams.delete('selected')
  }

  if (options.newQuery !== undefined) {
    if (options.newQuery) {
      newSearchParams.set('q', options.newQuery)
    } else {
      newSearchParams.delete('q')
    }
  }

  return newSearchParams
}
