// apps/web/src/components/timeline/event-description.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  ContactEventType,
  EntityInstanceEventType,
  TicketEventType,
  type TimelineEventBase,
} from '@auxx/lib/timeline/client'
import { Badge } from '@auxx/ui/components/badge'
import DOMPurify from 'dompurify'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { StatusBadge } from './status-badge'

/**
 * Render the actor for a timeline event. User actors get a full ActorBadge
 * (avatar + name resolved from the actor store cache); non-user actors
 * (system / automation / api / integration) fall back to a static label.
 */
function TimelineActorName({ actor }: { actor: TimelineEventBase['actor'] }) {
  if (actor.type === 'user' && actor.id) {
    return (
      <span className='inline-flex align-middle'>
        <ActorBadge
          actorId={actor.id}
          variant='text'
          showIcon={false}
          className='emphasis !text-[14px] !leading-normal'
        />
      </span>
    )
  }
  return <span className='emphasis'>{actor.name || 'System'}</span>
}

/**
 * Props for the EventDescription component
 */
interface EventDescriptionProps {
  event: TimelineEventBase
  onToggleExpand?: () => void
}

/**
 * Renders the description text for a timeline event based on its type
 */
export function EventDescription({ event, onToggleExpand }: EventDescriptionProps) {
  const hasExpandableContent = event.changes && event.changes.length > 0

  switch (event.eventType) {
    // =====================
    // CONTACT EVENTS
    // =====================
    case ContactEventType.CREATED:
      return (
        <>
          Contact{' '}
          <span className='emphasis'>
            {event.eventData.contact_first_name || event.eventData.firstName}{' '}
            {event.eventData.contact_last_name || event.eventData.lastName}
          </span>{' '}
          was created
        </>
      )

    case ContactEventType.UPDATED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> updated contact details
        </>
      )

    case ContactEventType.MERGED:
      return (
        <>
          Contact merged into <span className='emphasis'>{event.eventData.primaryContactName}</span>
        </>
      )

    case ContactEventType.STATUS_CHANGED:
      return (
        <div className='flex items-center gap-1.5'>
          Status changed to
          <StatusBadge status={event.eventData.contact_status || event.eventData.newStatus} />
        </div>
      )

    case ContactEventType.TICKET_CREATED:
      return (
        <>
          Ticket{' '}
          <span className='emphasis'>
            #{event.eventData.ticket_number || event.eventData.number}
          </span>{' '}
          created
          {(event.eventData.ticket_title || event.eventData.title) && (
            <div className='mt-0.5 truncate text-xs text-primary-500'>
              {event.eventData.ticket_title || event.eventData.title}
            </div>
          )}
          {event.relatedRecordId && (
            <div className='mt-1 inline-flex'>
              <RecordBadge
                recordId={event.relatedRecordId as RecordId}
                showIcon
                variant='link'
                link
              />
            </div>
          )}
        </>
      )

    case ContactEventType.TICKET_STATUS_CHANGED:
      return (
        <>
          Ticket{' '}
          <span className='emphasis'>
            #{event.eventData.ticket_number || event.eventData.number}
          </span>{' '}
          status changed to{' '}
          <StatusBadge status={event.eventData.ticket_status || event.eventData.newStatus} />
        </>
      )

    case ContactEventType.EMAIL_RECEIVED:
      return (
        <>
          <div className='mb-0.5 font-medium emphasis'>Email received</div>
          {event.eventData.subject && (
            <div className='truncate text-xs'>Subject: {event.eventData.subject}</div>
          )}
        </>
      )

    case ContactEventType.EMAIL_SENT:
      return (
        <>
          <div className='mb-0.5 font-medium emphasis'>Email sent</div>
          {event.eventData.subject && (
            <div className='truncate text-xs'>Subject: {event.eventData.subject}</div>
          )}
        </>
      )

    case ContactEventType.NOTE_ADDED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> added a note
          {event.eventData.content && (
            <div
              className='mt-1 line-clamp-2 text-xs'
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(event.eventData.content),
              }}
            />
          )}
        </>
      )

    case ContactEventType.NOTE_UPDATED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> updated a note
        </>
      )

    case ContactEventType.NOTE_DELETED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> deleted a note
        </>
      )

    case ContactEventType.GROUP_ADDED:
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <span>
            <TimelineActorName actor={event.actor} /> added to group
          </span>
          <Badge variant='green' size='sm'>
            {event.eventData.groupName}
          </Badge>
        </div>
      )

    case ContactEventType.GROUP_REMOVED:
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <span>
            <TimelineActorName actor={event.actor} /> removed from group
          </span>
          <Badge variant='red' size='sm'>
            {event.eventData.groupName}
          </Badge>
        </div>
      )

    case ContactEventType.TAG_ADDED:
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <span>
            <TimelineActorName actor={event.actor} /> added tags
          </span>
          <div className='flex gap-1'>
            {event.eventData.tags?.map((tag: string, idx: number) => (
              <Badge variant='pill' size='sm' key={idx}>
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )

    case ContactEventType.TAG_REMOVED:
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <span>
            <TimelineActorName actor={event.actor} /> removed tags
          </span>
          <div className='flex gap-1'>
            {event.eventData.tags?.map((tag: string, idx: number) => (
              <Badge variant='pill' size='sm' key={idx}>
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )

    case ContactEventType.ASSIGNED:
      return (
        <>
          Assigned to <span className='emphasis'>{event.eventData.assigneeName}</span>
        </>
      )

    case ContactEventType.UNASSIGNED:
      return (
        <>
          Unassigned from <span className='emphasis'>{event.eventData.assigneeName}</span>
        </>
      )

    // =====================
    // TICKET EVENTS
    // =====================
    case TicketEventType.CREATED:
      return (
        <>
          Ticket{' '}
          <span className='emphasis'>
            #{event.eventData.ticket_number || event.eventData.number}
          </span>{' '}
          was created
          {(event.eventData.ticket_title || event.eventData.title) && (
            <div className='mt-0.5 truncate text-xs text-primary-500'>
              {event.eventData.ticket_title || event.eventData.title}
            </div>
          )}
          {' for '}
          {event.relatedRecordId && (
            <div className='inline-flex'>
              <RecordBadge
                recordId={event.relatedRecordId as RecordId}
                showIcon
                variant='link'
                link
              />
            </div>
          )}
        </>
      )

    case TicketEventType.UPDATED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> updated ticket details
        </>
      )

    case TicketEventType.STATUS_CHANGED:
      return (
        <>
          Status changed to{' '}
          <StatusBadge status={event.eventData.ticket_status || event.eventData.newStatus} />
        </>
      )

    case TicketEventType.PRIORITY_CHANGED:
      return (
        <>
          Priority changed to{' '}
          <span className='emphasis'>
            {event.eventData.ticket_priority || event.eventData.newPriority}
          </span>
        </>
      )

    case TicketEventType.TYPE_CHANGED:
      return (
        <>
          Type changed to{' '}
          <span className='emphasis'>{event.eventData.ticket_type || event.eventData.newType}</span>
        </>
      )

    case TicketEventType.DELETED:
      return (
        <>
          Ticket <span className='emphasis'>deleted</span>
        </>
      )

    case TicketEventType.ARCHIVED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> archived this ticket
        </>
      )

    case TicketEventType.RESTORED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> restored this ticket
        </>
      )

    case TicketEventType.ASSIGNED:
      return (
        <>
          Assigned to{' '}
          <span className='emphasis'>
            {event.eventData.assignee_name || event.eventData.assigneeName || 'someone'}
          </span>
        </>
      )

    case TicketEventType.UNASSIGNED:
      return (
        <>
          Unassigned from{' '}
          <span className='emphasis'>
            {event.eventData.assignee_name || event.eventData.assigneeName || 'someone'}
          </span>
        </>
      )

    case TicketEventType.MESSAGE_RECEIVED:
      return (
        <>
          <div className='mb-0.5 font-medium emphasis'>Message received</div>
          {event.eventData.subject && (
            <div className='truncate text-xs'>Subject: {event.eventData.subject}</div>
          )}
        </>
      )

    case TicketEventType.MESSAGE_SENT:
    case TicketEventType.REPLY_SENT:
      return (
        <>
          <div className='mb-0.5 font-medium emphasis'>Reply sent</div>
          {event.eventData.subject && (
            <div className='truncate text-xs'>Subject: {event.eventData.subject}</div>
          )}
        </>
      )

    case TicketEventType.NOTE_ADDED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> added a note
          {event.eventData.content && (
            <div
              className='mt-1 line-clamp-2 text-xs'
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(event.eventData.content),
              }}
            />
          )}
        </>
      )

    case TicketEventType.NOTE_UPDATED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> updated a note
        </>
      )

    case TicketEventType.NOTE_DELETED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> deleted a note
        </>
      )

    case TicketEventType.MERGED:
      return (
        <>
          Ticket merged into{' '}
          <span className='emphasis'>
            #{event.eventData.target_ticket_number || event.eventData.targetTicketNumber}
          </span>
        </>
      )

    case TicketEventType.LINKED:
      return (
        <>
          Linked to ticket{' '}
          <span className='emphasis'>
            #{event.eventData.linked_ticket_number || event.eventData.linkedTicketNumber}
          </span>
        </>
      )

    case TicketEventType.UNLINKED:
      return (
        <>
          Unlinked from ticket{' '}
          <span className='emphasis'>
            #{event.eventData.unlinked_ticket_number || event.eventData.unlinkedTicketNumber}
          </span>
        </>
      )

    case TicketEventType.TAG_ADDED:
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <span>
            <TimelineActorName actor={event.actor} /> added tags
          </span>
          <div className='flex gap-1'>
            {event.eventData.tags?.map((tag: string, idx: number) => (
              <Badge variant='pill' size='sm' key={idx}>
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )

    case TicketEventType.TAG_REMOVED:
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <span>
            <TimelineActorName actor={event.actor} /> removed tags
          </span>
          <div className='flex gap-1'>
            {event.eventData.tags?.map((tag: string, idx: number) => (
              <Badge variant='pill' size='sm' key={idx}>
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )

    case TicketEventType.WORKFLOW_TRIGGERED:
      return (
        <>
          Workflow <span className='emphasis'>{event.eventData.workflowName || 'triggered'}</span>
        </>
      )

    case TicketEventType.WORKFLOW_COMPLETED:
      return (
        <>
          Workflow <span className='emphasis'>{event.eventData.workflowName || 'completed'}</span>
        </>
      )

    // =====================
    // CUSTOM ENTITY EVENTS
    // =====================
    case EntityInstanceEventType.CREATED:
      return (
        <>
          Record <span className='emphasis'>created</span>
        </>
      )

    case EntityInstanceEventType.UPDATED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> updated this record
        </>
      )

    // Field-updated: identical rendering for contact / ticket / custom entity
    case ContactEventType.FIELD_UPDATED:
    case TicketEventType.FIELD_UPDATED:
    case EntityInstanceEventType.FIELD_UPDATED:
      return (
        <div className='flex flex-wrap items-center gap-2'>
          <span>
            <TimelineActorName actor={event.actor} /> updated{' '}
            <span className='font-medium'>{event.eventData.fieldName}</span>
          </span>
          {hasExpandableContent && (
            <button
              type='button'
              onClick={onToggleExpand}
              className='inline-flex items-center rounded bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100'>
              View changes
            </button>
          )}
        </div>
      )

    case EntityInstanceEventType.DELETED:
      return (
        <>
          Record <span className='emphasis'>deleted</span>
        </>
      )

    case EntityInstanceEventType.ARCHIVED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> archived this record
        </>
      )

    case EntityInstanceEventType.RESTORED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> restored this record
        </>
      )

    case EntityInstanceEventType.NOTE_ADDED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> added a note
          {event.eventData.content && (
            <div
              className='mt-1 line-clamp-2 text-xs'
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(event.eventData.content),
              }}
            />
          )}
        </>
      )

    case EntityInstanceEventType.NOTE_UPDATED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> updated a note
        </>
      )

    case EntityInstanceEventType.NOTE_DELETED:
      return (
        <>
          <TimelineActorName actor={event.actor} /> deleted a note
        </>
      )

    case EntityInstanceEventType.WORKFLOW_TRIGGERED:
      return (
        <>
          Workflow <span className='emphasis'>{event.eventData.workflowName || 'triggered'}</span>
        </>
      )

    case EntityInstanceEventType.WORKFLOW_COMPLETED:
      return (
        <>
          Workflow <span className='emphasis'>{event.eventData.workflowName || 'completed'}</span>
        </>
      )

    default:
      return <>{event.eventType}</>
  }
}
