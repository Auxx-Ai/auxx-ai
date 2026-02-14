import { InternalFilterContextType } from '@auxx/lib/types'
import type { StatusSlug } from '~/components/mail/types'

/**
 * Configuration for mailbox display options
 */
export interface MailboxDisplayConfig {
  displayTabs: StatusSlug[]
  showBreadcrumbStatus: boolean
  breadcrumbTitle: string
}

/**
 * Determines which status tabs to display based on the contextType
 * @param contextType - The mailbox context type
 * @returns Array of StatusSlug values to display as tabs
 */
export function getDisplayTabsForContext(contextType: string): StatusSlug[] {
  // Contexts without standard status tabs
  if (
    contextType === InternalFilterContextType.DRAFTS ||
    contextType === InternalFilterContextType.SENT
  ) {
    return []
  }

  // Personal contexts
  if (
    contextType === InternalFilterContextType.PERSONAL_ASSIGNED ||
    contextType === InternalFilterContextType.PERSONAL_INBOX
  ) {
    return ['open', 'done', 'trash', 'spam']
  }

  // Shared/aggregate contexts
  if (
    contextType === InternalFilterContextType.ALL_INBOXES ||
    contextType === InternalFilterContextType.SPECIFIC_INBOX ||
    contextType === InternalFilterContextType.TAG ||
    contextType === InternalFilterContextType.VIEW
  ) {
    return ['unassigned', 'assigned', 'done', 'trash', 'spam']
  }

  // Default fallback tabs
  return ['open', 'done', 'trash', 'spam']
}

/**
 * Gets the breadcrumb title based on context type
 * @param contextType - The mailbox context type
 * @returns Human-readable title for breadcrumbs
 */
export function getBreadcrumbTitleForContext(contextType: string): string {
  switch (contextType) {
    case InternalFilterContextType.DRAFTS:
      return 'Drafts'
    case InternalFilterContextType.SENT:
      return 'Sent'
    case InternalFilterContextType.PERSONAL_ASSIGNED:
    case InternalFilterContextType.PERSONAL_INBOX:
      return 'Inbox'
    case InternalFilterContextType.ALL_INBOXES:
    case InternalFilterContextType.SPECIFIC_INBOX:
    case InternalFilterContextType.TAG:
    case InternalFilterContextType.VIEW:
      return 'Shared Inbox'
    default:
      return 'Mail'
  }
}

/**
 * Determines if the context should show status in breadcrumbs
 * @param contextType - The mailbox context type
 * @returns Boolean indicating if status should be shown
 */
export function shouldShowStatusInBreadcrumb(contextType: string): boolean {
  // Only show status for contexts that have meaningful status tabs
  return !(
    contextType === InternalFilterContextType.DRAFTS ||
    contextType === InternalFilterContextType.SENT
  )
}

/**
 * Gets complete display configuration for a mailbox context
 * @param contextType - The mailbox context type
 * @returns MailboxDisplayConfig object
 */
export function getMailboxDisplayConfig(contextType: string): MailboxDisplayConfig {
  return {
    displayTabs: getDisplayTabsForContext(contextType),
    showBreadcrumbStatus: shouldShowStatusInBreadcrumb(contextType),
    breadcrumbTitle: getBreadcrumbTitleForContext(contextType),
  }
}

/**
 * Status slug display options for dropdowns
 */
export interface StatusOption {
  value: StatusSlug
  label: string
  description?: string
}

/**
 * Gets status options formatted for dropdown display
 * @param availableStatuses - Array of available status slugs
 * @returns Array of StatusOption objects
 */
export function getStatusOptionsForDropdown(availableStatuses: StatusSlug[]): StatusOption[] {
  const statusDescriptions: Record<StatusSlug, string> = {
    open: 'Active conversations requiring attention',
    unassigned: 'Conversations not yet assigned to anyone',
    assigned: 'Conversations assigned to team members',
    done: 'Completed and resolved conversations',
    trash: 'Deleted conversations',
    spam: 'Spam and unwanted messages',
  }

  return availableStatuses.map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' '),
    description: statusDescriptions[status],
  }))
}

/**
 * Determines if a context type represents a personal inbox
 * @param contextType - The mailbox context type
 * @returns Boolean indicating if it's a personal context
 */
export function isPersonalContext(contextType: string): boolean {
  return (
    contextType === InternalFilterContextType.PERSONAL_ASSIGNED ||
    contextType === InternalFilterContextType.PERSONAL_INBOX ||
    contextType === InternalFilterContextType.DRAFTS ||
    contextType === InternalFilterContextType.SENT
  )
}

/**
 * Determines if a context type represents a shared/team inbox
 * @param contextType - The mailbox context type
 * @returns Boolean indicating if it's a shared context
 */
export function isSharedContext(contextType: string): boolean {
  return (
    contextType === InternalFilterContextType.ALL_INBOXES ||
    contextType === InternalFilterContextType.SPECIFIC_INBOX ||
    contextType === InternalFilterContextType.TAG ||
    contextType === InternalFilterContextType.VIEW
  )
}
