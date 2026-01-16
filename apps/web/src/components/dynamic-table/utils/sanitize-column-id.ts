// apps/web/src/components/dynamic-table/utils/sanitize-column-id.ts

/**
 * Sanitize column ID for use in CSS variables, selectors, and DOM attributes.
 * Replaces colons with underscores to ensure valid CSS syntax.
 *
 * ResourceFieldId format like "contact:email" becomes "contact_email"
 *
 * @param columnId - Column ID (potentially in ResourceFieldId format with colons)
 * @returns Sanitized column ID safe for CSS and DOM usage
 *
 * @example
 * sanitizeColumnId('contact:email')     // => 'contact_email'
 * sanitizeColumnId('ticket:status')     // => 'ticket_status'
 * sanitizeColumnId('_checkbox')         // => '_checkbox'
 */
export function sanitizeColumnId(columnId: string): string {
  return columnId.replace(/:/g, '_')
}
