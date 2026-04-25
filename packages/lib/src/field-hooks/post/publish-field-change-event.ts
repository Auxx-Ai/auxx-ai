// packages/lib/src/field-hooks/post/publish-field-change-event.ts

import { publisher } from '../../events'
import type {
  ContactFieldUpdatedEvent,
  EntityInstanceFieldUpdatedEvent,
  TicketFieldUpdatedEvent,
} from '../../events/types'
import type { EntityFieldChangeHandler } from '../types'

/**
 * Emit `<prefix>:field:updated` after every field write, mirroring the
 * lifecycle prefix convention used elsewhere in the events module.
 *
 * - entityType === 'contact' → 'contact:field:updated'
 * - entityType === 'ticket'  → 'ticket:field:updated'
 * - any other / null         → 'entity:field:updated'
 *
 * The data payload is identical across all three variants — only `type`
 * differs. Consumers that need entity-specific rendering (e.g. timeline)
 * switch on the event type; the shape is uniform.
 *
 * Registered globally ('*') so it fires for every entity write.
 */
export const publishFieldChangeEvent: EntityFieldChangeHandler = async (event) => {
  const data = {
    recordId: event.recordId,
    entityDefinitionId: event.entityDefinitionId,
    entitySlug: event.entitySlug,
    organizationId: event.organizationId,
    userId: event.userId,
    fieldId: event.field.id,
    fieldName: event.field.name,
    fieldType: event.field.type,
    oldValue: event.oldValue,
    newValue: event.newValue,
  }

  const type =
    event.entityType === 'contact'
      ? ('contact:field:updated' as const)
      : event.entityType === 'ticket'
        ? ('ticket:field:updated' as const)
        : ('entity:field:updated' as const)

  await publisher.publishLater({ type, data } as
    | ContactFieldUpdatedEvent
    | TicketFieldUpdatedEvent
    | EntityInstanceFieldUpdatedEvent)
}
