// apps/web/src/components/timeline/timeline-tab.tsx
'use client'

import { getDefinitionId, isSystemModelType, type RecordId } from '@auxx/types/resource'
import { Clock, History } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { useNormalizedRecordId } from '~/components/resources/utils/normalize-record-id'
import { api } from '~/trpc/react'
import { Timeline } from './timeline'

/** Props for TimelineTab component */
interface TimelineTabProps {
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
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
  description: <>Timeline events will appear as this record is updated</>,
}

/**
 * Generic timeline tab component that works with any entity type
 * Shows timeline events for a specific entity with infinite scroll
 */
export function TimelineTab({
  recordId,
  limit = 50,
  isGroupingDisabled = false,
  emptyTitle,
  emptyDescription,
}: TimelineTabProps) {
  // Normalize incoming recordId to canonical `<entityDefinitionId>:<instanceId>`
  // form so legacy `toRecordId('contact', id)` callers still hit the correct
  // timeline rows. Falls through unchanged once resources have loaded.
  const normalizedRecordId = useNormalizedRecordId(recordId) ?? recordId

  // Fetch timeline events with infinite scroll
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.timeline.getTimeline.useInfiniteQuery(
      {
        recordId: normalizedRecordId,
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
    return (
      <EmptyState
        icon={Clock}
        iconClassName='animate-spin'
        title='Loading timeline...'
        description={<>Hang on while we load the timeline events...</>}
      />
    )
  }

  if (events.length === 0) {
    return (
      <TimelineEmpty
        recordId={recordId}
        customTitle={emptyTitle}
        customDescription={emptyDescription}
      />
    )
  }

  return (
    <Timeline
      events={events}
      onLoadMore={() => fetchNextPage()}
      hasMore={hasNextPage}
      isLoading={isFetchingNextPage}
    />
  )
}

/**
 * Empty state component
 */
function TimelineEmpty({
  recordId,
  customTitle,
  customDescription,
}: {
  recordId: RecordId
  customTitle?: string
  customDescription?: React.ReactNode
}) {
  // Get entityDefinitionId from recordId
  const entityDefinitionId = getDefinitionId(recordId)

  // Get config - use custom if provided, else look up by type, else use default for custom entities
  const config = isSystemModelType(entityDefinitionId)
    ? EMPTY_STATE_CONFIG[entityDefinitionId] || DEFAULT_CUSTOM_ENTITY_EMPTY_STATE
    : DEFAULT_CUSTOM_ENTITY_EMPTY_STATE

  return (
    <EmptyState
      icon={History}
      title={customTitle || config.title}
      description={customDescription || config.description}
    />
  )
}
