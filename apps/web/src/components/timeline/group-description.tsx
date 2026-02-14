// apps/web/src/components/timeline/group-description.tsx
'use client'

import {
  ContactEventType,
  EntityInstanceEventType,
  TicketEventType,
  type TimelineEventBase,
} from '@auxx/lib/timeline/client'

/**
 * Props for the GroupDescription component
 */
interface GroupDescriptionProps {
  eventType: string
  events: TimelineEventBase[]
}

/**
 * Renders a description for a group of similar timeline events
 */
export function GroupDescription({ eventType, events }: GroupDescriptionProps) {
  const firstEvent = events[0]

  switch (eventType) {
    // Contact field updates
    case ContactEventType.FIELD_UPDATED:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> updated multiple
          fields
        </span>
      )

    case ContactEventType.TAG_ADDED:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> added multiple
          tags
        </span>
      )

    case ContactEventType.TAG_REMOVED:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> removed multiple
          tags
        </span>
      )

    // Ticket field updates
    case TicketEventType.FIELD_UPDATED:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> updated multiple
          fields
        </span>
      )

    case TicketEventType.TAG_ADDED:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> added multiple
          tags
        </span>
      )

    case TicketEventType.TAG_REMOVED:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> removed multiple
          tags
        </span>
      )

    // Entity instance field updates
    case EntityInstanceEventType.FIELD_UPDATED:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> updated multiple
          fields
        </span>
      )

    default:
      return (
        <span>
          <span className='emphasis'>{firstEvent?.actor.name || 'Someone'}</span> made multiple
          changes
        </span>
      )
  }
}
