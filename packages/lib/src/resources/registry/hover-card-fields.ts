// packages/lib/src/resources/registry/hover-card-fields.ts

import type { TableId } from './field-registry'

/**
 * Default fields to render in `RecordHoverCard` for each system resource.
 *
 * Values are **system attribute names** (e.g. `'ticket_status'`,
 * `'assigned_to_id'`) — the same identifiers `useSystemValues` accepts. The
 * client resolves these to `ResourceFieldId`s via the resource store's
 * `systemAttributeMap`. Resources omitted render header-only.
 *
 * Caller-supplied `fields` always overrides this default.
 */
export const HOVER_CARD_FIELDS: Partial<Record<TableId, string[]>> = {
  ticket: ['ticket_status', 'ticket_priority', 'assigned_to_id', 'due_date'],
  contact: ['phone', 'contact_company', 'customer_groups', 'contact_status'],
  company: ['company_website', 'company_industry', 'company_size', 'company_primary_contact'],
}

/**
 * Get the default hover-card system attribute names for a resource.
 * Returns an empty array for resources without defaults.
 */
export function getHoverCardFieldKeys(tableId: string): string[] {
  return HOVER_CARD_FIELDS[tableId as TableId] ?? []
}
