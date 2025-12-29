// apps/web/src/components/timeline/timeline-tab.tsx
'use client'

import { api } from '~/trpc/react'
import { Clock, History } from 'lucide-react'
import { Timeline } from './timeline'
import { EmptyState } from '~/components/global/empty-state'
import { isCustomEntityType, type TimelineEntityType } from '@auxx/lib/timeline/client'

/** Supported entity types for timeline - system types or custom entity types */
type EntityType = TimelineEntityType | string

/** Props for TimelineTab component */
interface TimelineTabProps {
  /** Type of entity (contact, ticket, etc. or entity:definitionId) */
  entityType: EntityType
  /** ID of the entity */
  entityId: string
  /** Optional limit for pagination */
  limit?: number
  /** Optional: disable event grouping */
  isGroupingDisabled?: boolean
  /** Optional: custom empty state title */
  emptyTitle?: string
  /** Optional: custom empty state description */
  emptyDescription?: React.ReactNode
}

/** Empty state configuration per system entity type */
const EMPTY_STATE_CONFIG: Record<
  string,
  {
    title: string
    description: React.ReactNode
  }
> = {
  contact: {
    title: 'No timeline events yet',
    description: (
      <>
        Timeline events will appear as tickets are created,
        <br />
        emails are sent, and other actions occur.
      </>
    ),
  },
  ticket: {
    title: 'No change history yet',
    description: (
      <>
        Timeline events will appear as the ticket is updated,
        <br />
        messages are sent, and other changes occur.
      </>
    ),
  },
  thread: {
    title: 'No timeline events yet',
    description: (
      <>
        Timeline events will appear as messages are exchanged
        <br />
        and thread properties change.
      </>
    ),
  },
  order: {
    title: 'No timeline events yet',
    description: (
      <>
        Timeline events will appear as the order is processed
        <br />
        and status changes occur.
      </>
    ),
  },
  user: {
    title: 'No activity yet',
    description: (
      <>
        Timeline events will appear as the user performs actions
        <br />
        and account changes occur.
      </>
    ),
  },
}

/** Default empty state for custom entities */
const DEFAULT_CUSTOM_ENTITY_EMPTY_STATE = {
  title: 'No timeline events yet',
  description: (
    <>
      Timeline events will appear as this record is updated
      <br />
      and changes occur.
    </>
  ),
}

/**
 * Generic timeline tab component that works with any entity type
 * Shows timeline events for a specific entity with infinite scroll
 */
export function TimelineTab({
  entityType,
  entityId,
  limit = 50,
  isGroupingDisabled = false,
  emptyTitle,
  emptyDescription,
}: TimelineTabProps) {
  // Fetch timeline events with infinite scroll
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.timeline.getTimeline.useInfiniteQuery(
      {
        entityType,
        entityId,
        limit,
        isGroupingDisabled,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    )

  // Flatten all pages into single event array
  const events = data?.pages.flatMap((page) => page.events) ?? []

  if (isLoading) {
    return <TimelineLoading />
  }

  if (events.length === 0) {
    return (
      <TimelineEmpty
        entityType={entityType}
        customTitle={emptyTitle}
        customDescription={emptyDescription}
      />
    )
  }

  return (
    <Timeline
      entityType={entityType}
      entityId={entityId}
      events={events}
      onLoadMore={() => fetchNextPage()}
      hasMore={hasNextPage}
      isLoading={isFetchingNextPage}
    />
  )
}

/**
 * Loading state component
 */
function TimelineLoading() {
  return (
    <EmptyState
      icon={Clock}
      iconClassName="animate-spin"
      title="Loading timeline..."
      description={<>Hang on while we load the timeline events...</>}
    />
  )
}

/**
 * Empty state component
 */
function TimelineEmpty({
  entityType,
  customTitle,
  customDescription,
}: {
  entityType: string
  customTitle?: string
  customDescription?: React.ReactNode
}) {
  // Get config - use custom if provided, else look up by type, else use default for custom entities
  const config = isCustomEntityType(entityType)
    ? DEFAULT_CUSTOM_ENTITY_EMPTY_STATE
    : EMPTY_STATE_CONFIG[entityType] || DEFAULT_CUSTOM_ENTITY_EMPTY_STATE

  return (
    <EmptyState
      icon={History}
      title={customTitle || config.title}
      description={customDescription || config.description}
    />
  )
}
