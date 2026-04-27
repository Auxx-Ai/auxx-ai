// apps/web/src/components/timeline/group-description.tsx
'use client'

import {
  ContactEventType,
  EntityInstanceEventType,
  TicketEventType,
  type TimelineEventBase,
} from '@auxx/lib/timeline/client'
import { ActorBadge } from '~/components/resources/ui/actor-badge'

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
  const firstActor = firstEvent?.actor
  const actor =
    firstActor?.type === 'user' && firstActor.id ? (
      <span className='inline-flex align-middle'>
        <ActorBadge
          actorId={firstActor.id}
          variant='text'
          showIcon={false}
          className='emphasis !text-[14px] !leading-normal'
        />
      </span>
    ) : (
      <span className='emphasis'>{firstActor?.name || 'System'}</span>
    )

  switch (eventType) {
    // Field updates — identical across contact / ticket / custom entity
    case ContactEventType.FIELD_UPDATED:
    case TicketEventType.FIELD_UPDATED:
    case EntityInstanceEventType.FIELD_UPDATED:
      return <span>{actor} updated multiple fields</span>

    // Tag adds — identical across contact / ticket
    case ContactEventType.TAG_ADDED:
    case TicketEventType.TAG_ADDED:
      return <span>{actor} added multiple tags</span>

    // Tag removes — identical across contact / ticket
    case ContactEventType.TAG_REMOVED:
    case TicketEventType.TAG_REMOVED:
      return <span>{actor} removed multiple tags</span>

    default:
      return <span>{actor} made multiple changes</span>
  }
}
