// apps/web/src/components/drawers/drawer-action-registry.tsx
'use client'

import type { Resource } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import type { ComponentType } from 'react'
import { ContactComposeAction } from './actions/contact-compose-action'
import { CreateNoteAction } from './actions/create-note-action'
import { CreateQuoteAction } from './actions/create-quote-action'
import { LinkInventorySourceAction } from './actions/link-inventory-source-action'
import { TicketReplyAction } from './actions/ticket-reply-action'

/**
 * Props passed to all drawer header-action components.
 */
export interface DrawerActionProps {
  recordId: RecordId
  entityInstanceId: string
  entityType: string
  record?: Record<string, unknown>
  resource?: Resource
  /** Bumps the Comments composer focus trigger. */
  onCreateNote: () => void
}

/**
 * Registry of header action components per entity type, rendered in order.
 * Falls back to the generic [CreateNoteAction] when an entity type isn't registered.
 */
const DRAWER_HEADER_ACTIONS: Record<string, ComponentType<DrawerActionProps>[]> = {
  contact: [ContactComposeAction, CreateNoteAction],
  ticket: [TicketReplyAction, CreateNoteAction],
  part: [LinkInventorySourceAction, CreateNoteAction],
  service_request: [CreateQuoteAction, CreateNoteAction],
}

export function getHeaderActions(entityType: string): ComponentType<DrawerActionProps>[] {
  return DRAWER_HEADER_ACTIONS[entityType] ?? [CreateNoteAction]
}
