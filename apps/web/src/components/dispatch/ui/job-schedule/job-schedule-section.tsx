// apps/web/src/components/dispatch/ui/job-schedule/job-schedule-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useQueryState } from 'nuqs'
import type { DetailViewTabProps } from '~/components/detail-view'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { splitJobVisits } from './job-schedule-utils'
import { RecurringEngagementCard } from './recurring-engagement-card'
import { type JobVisit, type UseJobVisitsResult, useJobVisits } from './use-job-visits'
import { VisitCard } from './visit-card'
import { VisitTreeRow } from './visit-tree-row'

/** Preview-row cap for the Upcoming/History blocks (04-ui.md §6: "1–2 TreeRow previews"). */
const PREVIEW_LIMIT = 2

/**
 * JobScheduleSection — registered as `work_order:schedule` (dispatch M2 build
 * spec §F.2/§F.3). Rendered inside DetailViewSections' own "Schedule"
 * `<Section>` anchor, so this contributes the primary visit card + the
 * Upcoming visits / History preview blocks (04-ui.md §6) without a redundant
 * outer heading. "More" and row clicks push the `?panel=visits`/`?item=<id>`
 * drill (the shared nuqs params `DetailViewSections` reads — any component
 * inside the sectioned page can drive them, not just the root).
 */
export function JobScheduleSection({ recordId }: DetailViewTabProps) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const [, setPanel] = useQueryState('panel')
  const [, setItem] = useQueryState('item')
  const { values } = useSystemValues(recordId, ['work_order_job_type', 'work_order_status'], {
    autoFetch: true,
  })
  const jobType = (values.work_order_job_type as string | undefined) ?? 'one_off'
  const status = (values.work_order_status as string | undefined) ?? 'new'

  const { upcoming, history } = splitJobVisits(visits)
  // The primary card's target visit — also the recurring engine's "next-upcoming visit"
  // (06-recurring-engine.md §6): one-off has exactly one, so this stays jobType-agnostic.
  const primaryVisit = upcoming[0] ?? visits[0]

  const openList = () => void setPanel('visits')
  const openItem = (visitId: string) => {
    void setPanel('visits')
    void setItem(visitId)
  }

  if (isLoading && visits.length === 0) {
    return <div className='p-4 text-sm text-muted-foreground'>Loading schedule...</div>
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      <VisitCard
        visit={primaryVisit}
        canEdit={canEdit}
        mutations={mutations}
        existingVisits={existingVisits}
        onRefresh={refresh}
        workOrderRecordId={recordId}
      />

      {jobType === 'recurring' && (
        <RecurringEngagementCard
          recordId={recordId}
          status={status}
          canEdit={canEdit}
          primaryVisit={primaryVisit}
          existingVisits={existingVisits}
          onRefresh={refresh}
        />
      )}

      <VisitPreviewBlock
        title='Upcoming visits'
        visits={upcoming.slice(0, PREVIEW_LIMIT)}
        hasMore={upcoming.length > PREVIEW_LIMIT || history.length > 0}
        emptyLabel='No upcoming visits.'
        canEdit={canEdit}
        mutations={mutations}
        existingVisits={existingVisits}
        workOrderRecordId={recordId}
        onRefresh={refresh}
        onMore={openList}
        onOpenItem={openItem}
      />

      <VisitPreviewBlock
        title='History'
        visits={history.slice(0, PREVIEW_LIMIT)}
        hasMore={history.length > PREVIEW_LIMIT}
        emptyLabel='No past visits yet.'
        canEdit={canEdit}
        mutations={mutations}
        existingVisits={existingVisits}
        workOrderRecordId={recordId}
        onRefresh={refresh}
        onMore={openList}
        onOpenItem={openItem}
      />
    </div>
  )
}

interface VisitPreviewBlockProps {
  title: string
  visits: JobVisit[]
  hasMore: boolean
  emptyLabel: string
  canEdit: boolean
  mutations: UseJobVisitsResult['mutations']
  existingVisits: ExistingVisitForOverlap[]
  workOrderRecordId: DetailViewTabProps['recordId']
  onRefresh: () => void
  onMore: () => void
  onOpenItem: (visitId: string) => void
}

function VisitPreviewBlock({
  title,
  visits,
  hasMore,
  emptyLabel,
  canEdit,
  mutations,
  existingVisits,
  workOrderRecordId,
  onRefresh,
  onMore,
  onOpenItem,
}: VisitPreviewBlockProps) {
  return (
    <div>
      <div className='flex items-center justify-between px-1 pb-1'>
        <span className='text-xs font-medium uppercase text-muted-foreground'>{title}</span>
        {hasMore && (
          <Button variant='ghost' size='xs' onClick={onMore}>
            More
          </Button>
        )}
      </div>
      {visits.length === 0 ? (
        <div className='rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground'>
          {emptyLabel}
        </div>
      ) : (
        <div className='rounded-lg border'>
          {visits.map((visit) => (
            <VisitTreeRow
              key={visit.id}
              visit={visit}
              canEdit={canEdit}
              mutations={mutations}
              existingVisits={existingVisits}
              workOrderRecordId={workOrderRecordId}
              onRefresh={onRefresh}
              onOpen={() => onOpenItem(visit.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default JobScheduleSection
