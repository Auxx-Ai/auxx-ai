// apps/web/src/components/dispatch/ui/job-schedule/job-schedule-section.tsx
'use client'

import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { ArrowRight, History } from 'lucide-react'
import { useQueryState } from 'nuqs'
import type { DetailViewTabProps } from '~/components/detail-view'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { splitJobVisits } from './job-schedule-utils'
import { RecurringEngagementCard } from './recurring-engagement-card'
import { ScheduleVisitRow } from './schedule-visit-row'
import { useJobVisits } from './use-job-visits'
import { VisitCard } from './visit-card'

/** Preview-row cap for the upcoming rows under the visit card and the History section. */
const PREVIEW_LIMIT = 3

/**
 * JobScheduleSection — registered as `work_order:schedule` (dispatch M2 build
 * spec §F.2/§F.3, 04 mock layout). One Schedule section carrying, top to bottom:
 * the recurrence row (recurring jobs — `RecurringEngagementCard`, which also
 * portals the engagement badge + Pause/Edit into the Section header), the
 * "Next visit" card, and the remaining upcoming visits as `ScheduleVisitRow`s
 * with a "View all →" drill. History stays its own section
 * (`VisitHistorySection`).
 */
export function JobScheduleSection({ recordId }: DetailViewTabProps) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const { values } = useSystemValues(recordId, ['work_order_job_type', 'work_order_status'], {
    autoFetch: true,
  })
  const [, setPanel] = useQueryState('panel')
  const [, setItem] = useQueryState('item')
  const jobType = (values.work_order_job_type as string | undefined) ?? 'one_off'
  const status = (values.work_order_status as string | undefined) ?? 'new'

  const { upcoming } = splitJobVisits(visits)
  // The primary card's target visit — also the recurring engine's "next-upcoming visit"
  // (06-recurring-engine.md §6): one-off has exactly one, so this stays jobType-agnostic.
  const primaryVisit = upcoming[0] ?? visits[0]
  // The primary visit already renders as the card — preview only the visits after it.
  const laterUpcoming = upcoming.slice(1)

  const openList = () => void setPanel('visits')
  const openItem = (visitId: string) => {
    void setPanel('visits')
    void setItem(visitId)
  }

  if (isLoading && visits.length === 0) {
    return <EmptySection loading title='Loading schedule' />
  }

  return (
    <div className='flex flex-col gap-3'>
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

      <VisitCard
        visit={primaryVisit}
        canEdit={canEdit}
        mutations={mutations}
        existingVisits={existingVisits}
        onRefresh={refresh}
        workOrderRecordId={recordId}
      />

      {laterUpcoming.length > 0 && (
        <div>
          <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
            {laterUpcoming.slice(0, PREVIEW_LIMIT).map((visit) => (
              <ScheduleVisitRow
                key={visit.id}
                visit={visit}
                canEdit={canEdit}
                mutations={mutations}
                existingVisits={existingVisits}
                workOrderRecordId={recordId}
                onRefresh={refresh}
                onOpen={() => openItem(visit.id)}
              />
            ))}
          </div>

          {laterUpcoming.length > PREVIEW_LIMIT && (
            <ViewAllRow label={`View all ${upcoming.length} upcoming visits`} onClick={openList} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Registered as `work_order:history` — standalone visit History section: the
 * same `ScheduleVisitRow`s capped at PREVIEW_LIMIT, plus a "View all →"
 * link that pushes the `?panel=visits` drill (the shared nuqs params
 * `DetailViewSections` reads). The section heading comes from the surrounding
 * `<Section>` — no block header here.
 */
export function VisitHistorySection({ recordId }: DetailViewTabProps) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const [, setPanel] = useQueryState('panel')
  const [, setItem] = useQueryState('item')

  const { history } = splitJobVisits(visits)

  const openList = () => void setPanel('visits')
  const openItem = (visitId: string) => {
    void setPanel('visits')
    void setItem(visitId)
  }

  const loading = isLoading && visits.length === 0
  if (loading || history.length === 0) {
    return (
      <EmptySection
        loading={loading}
        icon={<History className='size-5' />}
        title='No past visits yet'
        description='Completed and canceled visits show up here.'
      />
    )
  }

  return (
    <div>
      <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
        {history.slice(0, PREVIEW_LIMIT).map((visit) => (
          <ScheduleVisitRow
            key={visit.id}
            visit={visit}
            canEdit={canEdit}
            mutations={mutations}
            existingVisits={existingVisits}
            workOrderRecordId={recordId}
            onRefresh={refresh}
            onOpen={() => openItem(visit.id)}
          />
        ))}
      </div>

      {history.length > PREVIEW_LIMIT && (
        <ViewAllRow label={`View all ${history.length} past visits`} onClick={openList} />
      )}
    </div>
  )
}

/** The 04 mock's "View all N … →" text link under the visit rows. */
function ViewAllRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='mt-1 flex items-center gap-1 px-1 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground'>
      {label}
      <ArrowRight className='size-3.5' />
    </button>
  )
}

export default JobScheduleSection
