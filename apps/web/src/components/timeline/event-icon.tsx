// apps/web/src/components/timeline/event-icon.tsx
'use client'

import {
  ContactEventType,
  EntityInstanceEventType,
  TicketEventType,
} from '@auxx/lib/timeline/client'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertCircle,
  Archive,
  Edit,
  FileText,
  Mail,
  MessageSquare,
  Plus,
  RotateCcw,
  Settings,
  Tag,
  Trash2,
  User,
  Users,
} from 'lucide-react'

/**
 * Props for the EventIcon component
 */
interface EventIconProps {
  icon: React.ComponentType<{ className?: string }>
  color: string
}

/**
 * Renders an icon for a timeline event
 */
export function EventIcon({ icon: Icon, color }: EventIconProps) {
  return (
    <div
      className={cn(
        'size-6 border border-black/10 dark:border-white/10 bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0',
        color
      )}>
      <Icon className='size-3.5' />
    </div>
  )
}

/**
 * Returns the appropriate icon component for an event type
 */
export function getEventIcon(eventType: string) {
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

    // Ticket events
    case TicketEventType.CREATED:
      return Plus
    case TicketEventType.UPDATED:
    case TicketEventType.FIELD_UPDATED:
      return Edit
    case TicketEventType.STATUS_CHANGED:
      return AlertCircle
    case TicketEventType.PRIORITY_CHANGED:
    case TicketEventType.TYPE_CHANGED:
      return Settings
    case TicketEventType.ASSIGNED:
    case TicketEventType.UNASSIGNED:
      return User
    case TicketEventType.MESSAGE_RECEIVED:
    case TicketEventType.MESSAGE_SENT:
    case TicketEventType.REPLY_SENT:
      return Mail
    case TicketEventType.NOTE_ADDED:
    case TicketEventType.NOTE_UPDATED:
      return FileText
    case TicketEventType.NOTE_DELETED:
    case TicketEventType.DELETED:
      return Trash2
    case TicketEventType.ARCHIVED:
      return Archive
    case TicketEventType.RESTORED:
      return RotateCcw
    case TicketEventType.MERGED:
      return Users
    case TicketEventType.TAG_ADDED:
    case TicketEventType.TAG_REMOVED:
      return Tag

    // Custom entity events
    case EntityInstanceEventType.CREATED:
      return Plus
    case EntityInstanceEventType.UPDATED:
    case EntityInstanceEventType.FIELD_UPDATED:
      return Edit
    case EntityInstanceEventType.DELETED:
      return Trash2
    case EntityInstanceEventType.ARCHIVED:
      return Archive
    case EntityInstanceEventType.RESTORED:
      return RotateCcw
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

/**
 * Returns the appropriate color classes for an event type
 */
export function getEventColor(eventType: string) {
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
      return 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-50'

    // Ticket events
    case TicketEventType.CREATED:
    case TicketEventType.RESTORED:
      return 'bg-good-100 text-good-600'
    case TicketEventType.UPDATED:
    case TicketEventType.FIELD_UPDATED:
    case TicketEventType.UNASSIGNED:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-100'
    case TicketEventType.STATUS_CHANGED:
    case TicketEventType.PRIORITY_CHANGED:
    case TicketEventType.TYPE_CHANGED:
      return 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-50'
    case TicketEventType.ASSIGNED:
    case TicketEventType.MERGED:
      return 'bg-comparison-100 text-comparison-600'
    case TicketEventType.MESSAGE_RECEIVED:
    case TicketEventType.MESSAGE_SENT:
    case TicketEventType.REPLY_SENT:
      return 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-50'
    case TicketEventType.NOTE_ADDED:
    case TicketEventType.NOTE_UPDATED:
      return 'bg-yellow-100 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-50'
    case TicketEventType.NOTE_DELETED:
    case TicketEventType.DELETED:
      return 'bg-bad-100 text-bad-600'
    case TicketEventType.ARCHIVED:
      return 'bg-orange-100 text-orange-600'
    case TicketEventType.TAG_ADDED:
    case TicketEventType.TAG_REMOVED:
      return 'bg-indigo-100 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-400'

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
