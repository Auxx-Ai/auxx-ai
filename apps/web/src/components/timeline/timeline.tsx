// apps/web/src/components/timeline/timeline.tsx
'use client'
import DOMPurify from 'dompurify'

import {
  Settings,
  Plus,
  User,
  Mail,
  MessageSquare,
  Edit,
  Tag,
  Users,
  FileText,
  Trash2,
  ChevronDown,
  ArrowRight,
  AlertCircle,
  ChevronLeft,
} from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import {
  ContactEventType,
  EntityInstanceEventType,
  groupTimelineEventsByPeriod,
  type PeriodType,
  type TimelineEventBase,
  type TimelineItem,
  type GroupedTimelineEvent,
} from '@auxx/lib/timeline/client'
import { formatDistanceToNowStrict } from 'date-fns'
import { useState, useMemo } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'

/**
 * Main Timeline Container Component
 */
interface TimelineProps {
  entityType: string
  entityId: string
  events: TimelineItem[]
  onLoadMore?: () => void
  hasMore?: boolean
  isLoading?: boolean
}

export function Timeline({ events, onLoadMore, hasMore, isLoading }: TimelineProps) {
  // Group events by year and period
  const groupedData = useMemo(() => groupTimelineEventsByPeriod(events), [events])

  // Track collapsed state for each period
  // Key format: "year-periodType" (e.g., "2025-upcoming", "2024-11")
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set())

  /**
   * Toggle collapse state for a period
   */
  const togglePeriod = (year: number, periodType: PeriodType) => {
    const key = `${year}-${periodType}`
    setCollapsedPeriods((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  /**
   * Check if a period is collapsed
   */
  const isPeriodCollapsed = (year: number, periodType: PeriodType): boolean => {
    return collapsedPeriods.has(`${year}-${periodType}`)
  }

  return (
    <div className="timeline-events relative w-full">
      {groupedData.map((yearGroup) => (
        <div key={yearGroup.year}>
          {yearGroup.periods.map((period, periodIndex) => {
            const isCollapsed = isPeriodCollapsed(yearGroup.year, period.type)
            const isFirstPeriodOfYear = periodIndex === 0

            return (
              <div key={`${yearGroup.year}-${period.type}`} className="">
                {/* Render period header */}
                <TimelinePeriodHeader
                  year={isFirstPeriodOfYear ? String(yearGroup.year) : ''}
                  period={period.title}
                  isCollapsed={isCollapsed}
                  onToggle={() => togglePeriod(yearGroup.year, period.type)}
                />

                {/* Render events if not collapsed */}
                {!isCollapsed && (
                  <>
                    {period.events.map((item, index) => {
                      if (item.type === 'single') {
                        return <TimelineEventItem key={item.event.id} event={item.event} />
                      }

                      return (
                        <TimelineGroupedItem
                          key={`group-${yearGroup.year}-${period.type}-${index}`}
                          groupedEvent={item}
                        />
                      )
                    })}
                  </>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {hasMore && (
        <div className="flex justify-center py-4">
          <Button
            onClick={onLoadMore}
            variant="ghost"
            size="sm"
            loading={isLoading}
            loadingText="Loading...">
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Timeline Period Header Component
 */
interface TimelinePeriodHeaderProps {
  year: string
  period: string
  isCollapsed?: boolean
  onToggle?: () => void
}

export function TimelinePeriodHeader({
  year,
  period,
  isCollapsed = false,
  onToggle,
}: TimelinePeriodHeaderProps) {
  return (
    <div className="flex flex-col pb-2">
      {/* Year Label */}
      {year && <div className="text-sm font-medium text-primary-400 mb-1">{year}</div>}

      {/* Period Label with Toggle */}
      <div className="flex items-center gap-1">
        <Badge variant="pill" size="sm" className="">
          {period}
        </Badge>
        <span className="h-px flex-1 bg-primary-100" role="none" />

        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onToggle}
          aria-label={isCollapsed ? 'Expand period' : 'Collapse period'}>
          {isCollapsed ? <ChevronLeft /> : <ChevronDown />}
        </Button>
      </div>
    </div>
  )
}

/**
 * Single Timeline Event Item
 */
interface TimelineEventItemProps {
  event: TimelineEventBase
  compact?: boolean
}

export function TimelineEventItem({ event, compact = false }: TimelineEventItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const icon = getEventIcon(event.eventType)
  const color = getEventColor(event.eventType)

  return (
    <div
      className={cn(
        'relative pb-6 last:pb-3 before:absolute before:inset-y-0 before:left-4.5 before:w-px before:bg-primary-300 before:z-0 last:before:hidden'
      )}>
      <div
        className={cn(
          'relative z-1 flex ps-1 pe-2 py-1 gap-2 bg-illustration ring-border-illustration origin-bottom rounded-2xl border border-transparent  shadow shadow-black/10 ring-1 transition-all duration-300'
        )}>
        {/* Icon */}
        <EventIcon icon={icon} color={color} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            {/* Event Description */}
            <div className="text-[14px]  text-primary-400 dark:text-primary-500">
              <EventDescription event={event} onToggleExpand={() => setIsExpanded(!isExpanded)} />

              {/* Expanded Details */}
              {isExpanded && event.changes && event.changes.length > 0 && (
                <div className="mt-2 space-y-1 text-xs">
                  {event.changes.map((change, idx) => (
                    <ChangeDetail key={idx} change={change} />
                  ))}
                </div>
              )}
            </div>

            {/* Timestamp */}
            <div className="pt-1">
              <EventTimestamp timestamp={event.startedAt} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Grouped Timeline Events
 */
interface TimelineGroupedItemProps {
  groupedEvent: GroupedTimelineEvent
}

export function TimelineGroupedItem({ groupedEvent }: TimelineGroupedItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const icon = getEventIcon(groupedEvent.eventType)
  const color = getEventColor(groupedEvent.eventType)
  const eventCount = groupedEvent.events.length
  // className="flex gap-3 border-b border-primary-100 py-3 transition-colors hover:bg-gray-50/50">
  return (
    <div
      className={cn(
        'relative pb-6 last:pb-3 before:absolute before:inset-y-0 before:left-4.5 before:w-px before:bg-primary-300 before:z-0 last:before:hidden'
      )}>
      <div
        className={cn(
          'relative z-1 flex ps-1 pe-2 py-1 gap-2 bg-illustration ring-border-illustration origin-bottom rounded-2xl border border-transparent  shadow shadow-black/10 ring-1 transition-all duration-300'
        )}>
        {/* Icon */}
        <EventIcon icon={icon} color={color} />

        {/* Content */}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-4">
            {/* Group Description */}
            <div className="text-sm ">
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-primary-400 dark:text-primary-500">
                <GroupDescription eventType={groupedEvent.eventType} events={groupedEvent.events} />

                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="inline-flex items-center rounded bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100">
                  {eventCount} {eventCount === 1 ? 'change' : 'changes'}
                </button>
              </div>

              {/* Expanded Events */}
              {isExpanded && (
                <div className="mt-3 space-y-2 pl-0">
                  {groupedEvent.events.map((event) => (
                    <div key={event.id} className="text-xs">
                      {event.changes?.map((change, idx) => (
                        <ChangeDetail key={idx} change={change} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Timestamp */}
          </div>
        </div>
        <div className="pt-1">
          <EventTimestamp timestamp={groupedEvent.startedAt} />
        </div>
      </div>
    </div>
  )
}

/**
 * Event Icon Component
 */
interface EventIconProps {
  icon: React.ComponentType<{ className?: string }>
  color: string
}

function EventIcon({ icon: Icon, color }: EventIconProps) {
  return (
    <div
      className={cn(
        'size-6 border border-black/10 dark:border-white/10 bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0',
        color
      )}>
      <Icon className="size-3.5" />
    </div>
  )
}

/**
 * Event Description Component
 */
interface EventDescriptionProps {
  event: TimelineEventBase
  onToggleExpand?: () => void
}

function EventDescription({ event, onToggleExpand }: EventDescriptionProps) {
  const hasExpandableContent = event.changes && event.changes.length > 0

  switch (event.eventType) {
    case ContactEventType.CREATED:
      return (
        <>
          Contact{' '}
          <span className="emphasis">
            {event.eventData.firstName} {event.eventData.lastName}
          </span>{' '}
          was created
        </>
      )

    case ContactEventType.UPDATED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> updated contact details
        </>
      )

    case ContactEventType.MERGED:
      return (
        <>
          Contact merged into <span className="emphasis">{event.eventData.primaryContactName}</span>
        </>
      )

    case ContactEventType.STATUS_CHANGED:
      return (
        <div className="flex items-center gap-1.5 ">
          Status changed to
          <StatusBadge status={event.eventData.newStatus} />
        </div>
      )

    case ContactEventType.TICKET_CREATED:
      return (
        <>
          Ticket <span className="emphasis">#{event.eventData.number}</span> created
          {event.eventData.title && (
            <div className="mt-0.5 truncate text-xs text-primary-500">{event.eventData.title}</div>
          )}
        </>
      )

    case ContactEventType.TICKET_STATUS_CHANGED:
      return (
        <>
          Ticket <span className="emphasis">#{event.eventData.number}</span> status changed to{' '}
          <StatusBadge status={event.eventData.newStatus} />
        </>
      )

    case ContactEventType.EMAIL_RECEIVED:
      return (
        <>
          <div className="mb-0.5 font-medium emphasis">Email received</div>
          {event.eventData.subject && (
            <div className="truncate text-xs ">Subject: {event.eventData.subject}</div>
          )}
        </>
      )

    case ContactEventType.EMAIL_SENT:
      return (
        <>
          <div className="mb-0.5 font-medium emphasis">Email sent</div>
          {event.eventData.subject && (
            <div className="truncate text-xs ">Subject: {event.eventData.subject}</div>
          )}
        </>
      )

    case ContactEventType.NOTE_ADDED:
      return (
        <>
          <span className=" emphasis">{event.actor.name || 'Someone'}</span> added a note
          {event.eventData.content && (
            <div
              className="mt-1 line-clamp-2 text-xs "
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(event.eventData.content),
              }}></div>
          )}
        </>
      )

    case ContactEventType.NOTE_UPDATED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> updated a note
        </>
      )

    case ContactEventType.NOTE_DELETED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> deleted a note
        </>
      )

    case ContactEventType.GROUP_ADDED:
      return (
        <div className="flex flex-wrap items-center gap-2 ">
          <span>
            <span className="emphasis">{event.actor.name || 'Someone'}</span> added to group
          </span>
          <Badge variant="green" size="sm">
            {event.eventData.groupName}
          </Badge>
        </div>
      )

    case ContactEventType.GROUP_REMOVED:
      return (
        <div className="flex flex-wrap items-center gap-2 ">
          <span>
            <span className="emphasis">{event.actor.name || 'Someone'}</span> removed from group
          </span>
          <Badge variant="red" size="sm">
            {event.eventData.groupName}
          </Badge>
        </div>
      )

    case ContactEventType.TAG_ADDED:
      return (
        <div className="flex flex-wrap items-center gap-2 ">
          <span>
            <span className="emphasis">{event.actor.name || 'Someone'}</span> added tags
          </span>
          <div className="flex gap-1">
            {event.eventData.tags?.map((tag: string, idx: number) => (
              <Badge variant="pill" size="sm" key={idx}>
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )

    case ContactEventType.TAG_REMOVED:
      return (
        <div className="flex flex-wrap items-center gap-2 ">
          <span>
            <span className="emphasis">{event.actor.name || 'Someone'}</span> removed tags
          </span>
          <div className="flex gap-1">
            {event.eventData.tags?.map((tag: string, idx: number) => (
              <Badge variant="pill" size="sm" key={idx}>
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )

    case ContactEventType.FIELD_UPDATED:
      return (
        <div className="flex flex-wrap items-center gap-2 ">
          <span>
            <span className="emphasis">{event.actor.name || 'Someone'}</span> updated{' '}
            <span className="font-medium">{event.eventData.fieldName}</span>
          </span>
          {hasExpandableContent && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center rounded bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100 ">
              View changes
            </button>
          )}
        </div>
      )

    case ContactEventType.ASSIGNED:
      return (
        <>
          Assigned to <span className="emphasis">{event.eventData.assigneeName}</span>
        </>
      )

    case ContactEventType.UNASSIGNED:
      return (
        <>
          Unassigned from <span className="emphasis">{event.eventData.assigneeName}</span>
        </>
      )

    // Custom entity events
    case EntityInstanceEventType.CREATED:
      return (
        <>
          Record <span className="emphasis">created</span>
        </>
      )

    case EntityInstanceEventType.UPDATED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> updated this record
        </>
      )

    case EntityInstanceEventType.FIELD_UPDATED:
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            <span className="emphasis">{event.actor.name || 'Someone'}</span> updated{' '}
            <span className="font-medium">{event.eventData.fieldName}</span>
          </span>
          {hasExpandableContent && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center rounded bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100">
              View changes
            </button>
          )}
        </div>
      )

    case EntityInstanceEventType.DELETED:
      return (
        <>
          Record <span className="emphasis">deleted</span>
        </>
      )

    case EntityInstanceEventType.ARCHIVED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> archived this record
        </>
      )

    case EntityInstanceEventType.RESTORED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> restored this record
        </>
      )

    case EntityInstanceEventType.NOTE_ADDED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> added a note
        </>
      )

    case EntityInstanceEventType.NOTE_UPDATED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> updated a note
        </>
      )

    case EntityInstanceEventType.NOTE_DELETED:
      return (
        <>
          <span className="emphasis">{event.actor.name || 'Someone'}</span> deleted a note
        </>
      )

    case EntityInstanceEventType.WORKFLOW_TRIGGERED:
      return (
        <>
          Workflow <span className="emphasis">{event.eventData.workflowName || 'triggered'}</span>
        </>
      )

    case EntityInstanceEventType.WORKFLOW_COMPLETED:
      return (
        <>
          Workflow <span className="emphasis">{event.eventData.workflowName || 'completed'}</span>
        </>
      )

    default:
      return <>{event.eventType}</>
  }
}

/**
 * Group Description Component
 */
interface GroupDescriptionProps {
  eventType: string
  events: TimelineEventBase[]
}

function GroupDescription({ eventType, events }: GroupDescriptionProps) {
  const firstEvent = events[0]

  switch (eventType) {
    case ContactEventType.FIELD_UPDATED:
    case EntityInstanceEventType.FIELD_UPDATED:
      return (
        <span>
          <span className="emphasis">{firstEvent?.actor.name || 'Someone'}</span> updated multiple
          fields
        </span>
      )

    case ContactEventType.TAG_ADDED:
      return (
        <span>
          <span className="emphasis">{firstEvent?.actor.name || 'Someone'}</span> added multiple
          tags
        </span>
      )

    case ContactEventType.TAG_REMOVED:
      return (
        <span>
          <span className="emphasis">{firstEvent?.actor.name || 'Someone'}</span> removed multiple
          tags
        </span>
      )

    default:
      return (
        <span>
          <span className="emphasis">{firstEvent?.actor.name || 'Someone'}</span> made multiple
          changes
        </span>
      )
  }
}

/**
 * Change Detail Component (for showing field changes)
 */
interface ChangeDetailProps {
  change: {
    field: string
    oldValue: any
    newValue: any
  }
}

function ChangeDetail({ change }: ChangeDetailProps) {
  return (
    <div className="flex items-center gap-2 ">
      <span className="font-medium">{change.field}:</span>
      {change.oldValue !== null && change.oldValue !== undefined && (
        <>
          <span className="text-primary-400 line-through">{formatValue(change.oldValue)}</span>
          <ArrowRight />
        </>
      )}
      <span className="emphasis">{formatValue(change.newValue)}</span>
    </div>
  )
}

/**
 * Event Timestamp Component
 */
interface EventTimestampProps {
  timestamp: Date
}

function EventTimestamp({ timestamp }: EventTimestampProps) {
  return (
    <div className="flex-shrink-0 whitespace-nowrap text-xs text-primary-muted">
      {formatDistanceToNowStrict(new Date(timestamp), { addSuffix: true })}
    </div>
  )
}

/**
 * Status Badge Component
 */
interface StatusBadgeProps {
  status: string
}

function StatusBadge({ status }: StatusBadgeProps) {
  const colors = {
    OPEN: 'bg-blue-100 text-blue-700',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
    RESOLVED: 'bg-green-100 text-green-700',
    CLOSED: 'bg-gray-100 text-gray-700',
    ACTIVE: 'bg-green-100 text-green-700',
    INACTIVE: 'bg-gray-100 text-gray-700',
    SPAM: 'bg-red-100 text-red-700',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-700'
      )}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

/**
 * Helper Functions
 */

function getEventIcon(eventType: string) {
  switch (eventType) {
    // Contact events
    case ContactEventType.CREATED:
      return Plus
    case ContactEventType.UPDATED:
    case ContactEventType.FIELD_UPDATED:
      return Edit
    case ContactEventType.MERGED:
      return Users
    case ContactEventType.STATUS_CHANGED:
      return AlertCircle
    case ContactEventType.TICKET_CREATED:
    case ContactEventType.TICKET_UPDATED:
    case ContactEventType.TICKET_STATUS_CHANGED:
      return MessageSquare
    case ContactEventType.EMAIL_RECEIVED:
    case ContactEventType.EMAIL_SENT:
      return Mail
    case ContactEventType.NOTE_ADDED:
    case ContactEventType.NOTE_UPDATED:
      return FileText
    case ContactEventType.NOTE_DELETED:
      return Trash2
    case ContactEventType.GROUP_ADDED:
    case ContactEventType.GROUP_REMOVED:
      return Users
    case ContactEventType.TAG_ADDED:
    case ContactEventType.TAG_REMOVED:
      return Tag
    case ContactEventType.ASSIGNED:
    case ContactEventType.UNASSIGNED:
      return User

    // Custom entity events
    case EntityInstanceEventType.CREATED:
      return Plus
    case EntityInstanceEventType.UPDATED:
    case EntityInstanceEventType.FIELD_UPDATED:
      return Edit
    case EntityInstanceEventType.DELETED:
      return Trash2
    case EntityInstanceEventType.ARCHIVED:
    case EntityInstanceEventType.RESTORED:
      return AlertCircle
    case EntityInstanceEventType.NOTE_ADDED:
    case EntityInstanceEventType.NOTE_UPDATED:
      return FileText
    case EntityInstanceEventType.NOTE_DELETED:
      return Trash2
    case EntityInstanceEventType.WORKFLOW_TRIGGERED:
    case EntityInstanceEventType.WORKFLOW_COMPLETED:
      return Settings

    default:
      return Settings
  }
}

function getEventColor(eventType: string) {
  switch (eventType) {
    // Contact events
    case ContactEventType.CREATED:
      return 'bg-good-100 text-good-600'
    case ContactEventType.UPDATED:
    case ContactEventType.FIELD_UPDATED:
    case ContactEventType.GROUP_REMOVED:
    case ContactEventType.TAG_REMOVED:
    case ContactEventType.UNASSIGNED:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-100'
    case ContactEventType.MERGED:
    case ContactEventType.ASSIGNED:
      return 'bg-comparison-100 text-comparison-600'
    case ContactEventType.STATUS_CHANGED:
    case ContactEventType.TICKET_CREATED:
    case ContactEventType.TICKET_UPDATED:
    case ContactEventType.TICKET_STATUS_CHANGED:
      return 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-50'
    case ContactEventType.NOTE_ADDED:
    case ContactEventType.NOTE_UPDATED:
      return 'bg-yellow-100 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-50'
    case ContactEventType.NOTE_DELETED:
      return 'bg-bad-100 text-bad-600'
    case ContactEventType.GROUP_ADDED:
    case ContactEventType.TAG_ADDED:
      return 'bg-indigo-100 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-400'
    case ContactEventType.EMAIL_RECEIVED:
    case ContactEventType.EMAIL_SENT:

    // Custom entity events
    case EntityInstanceEventType.CREATED:
    case EntityInstanceEventType.RESTORED:
      return 'bg-good-100 text-good-600'
    case EntityInstanceEventType.UPDATED:
    case EntityInstanceEventType.FIELD_UPDATED:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-100'
    case EntityInstanceEventType.DELETED:
    case EntityInstanceEventType.NOTE_DELETED:
      return 'bg-bad-100 text-bad-600'
    case EntityInstanceEventType.ARCHIVED:
      return 'bg-orange-100 text-orange-600'
    case EntityInstanceEventType.NOTE_ADDED:
    case EntityInstanceEventType.NOTE_UPDATED:
      return 'bg-yellow-100 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-50'
    case EntityInstanceEventType.WORKFLOW_TRIGGERED:
      return 'bg-indigo-100 text-indigo-600'
    case EntityInstanceEventType.WORKFLOW_COMPLETED:
      return 'bg-good-100 text-good-600'

    default:
      return 'bg-accent-100 text-accent-600'
  }
}

function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}
