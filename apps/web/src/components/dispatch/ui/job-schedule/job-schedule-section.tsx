// apps/web/src/components/dispatch/ui/job-schedule/job-schedule-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { History, Plus } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { DetailSectionActions, type DetailViewTabProps } from '~/components/detail-view'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { SchedulePopover } from '../schedule-popover'
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
 * with an inline "Show more" expand. History stays its own section
 * (`VisitHistorySection`).
 */
export function JobScheduleSection({ recordId }: DetailViewTabProps) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const { values } = useSystemValues(recordId, ['work_order_job_type', 'work_order_status'], {
    autoFetch: true,
  })
  const [, setPanel] = useQueryState('panel')
  const [, setItem] = useQueryState('item')
  const [addOpen, setAddOpen] = useState(false)
  const jobType = (values.work_order_job_type as string | undefined) ?? 'one_off'
  const status = (values.work_order_status as string | undefined) ?? 'new'

  const { upcoming } = splitJobVisits(visits)
  // The primary card's target visit — also the recurring engine's "next-upcoming visit"
  // (06-recurring-engine.md §6): one-off has exactly one, so this stays jobType-agnostic.
  // Never falls back into history (plan 30 §G.2) — no upcoming visits is an empty state,
  // not a "next visit" mislabel on a done/canceled row.
  const primaryVisit = upcoming[0]
  // The primary visit already renders as the card — preview only the visits after it.
  const laterUpcoming = upcoming.slice(1)

  const openItem = (visitId: string) => {
    void setPanel('visits')
    void setItem(visitId)
  }

  if (isLoading && visits.length === 0) {
    return <EmptySection loading title='Loading schedule' />
  }

  return (
    <div className='flex flex-col gap-3'>
      {canEdit && (
        <DetailSectionActions>
          {/* CREATE-mode SchedulePopover (no visitId) — nothing exists until Schedule commits,
           * which creates + schedules the rule-less extra visit in one addVisit call. */}
          <SchedulePopover
            open={addOpen}
            onOpenChange={setAddOpen}
            workOrderRecordId={recordId}
            existingVisits={existingVisits}
            onScheduled={() => {
              setAddOpen(false)
              refresh()
            }}
            trigger={
              <Button variant='outline' size='xs'>
                <Plus /> Add visit
              </Button>
            }
          />
        </DetailSectionActions>
      )}

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
        <TreeRowList
          items={laterUpcoming}
          getKey={(visit) => visit.id}
          visibleLimit={PREVIEW_LIMIT}
          className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}
          renderRow={(visit) => (
            <ScheduleVisitRow
              visit={visit}
              canEdit={canEdit}
              mutations={mutations}
              existingVisits={existingVisits}
              workOrderRecordId={recordId}
              onRefresh={refresh}
              onOpen={() => openItem(visit.id)}
            />
          )}
        />
      )}
    </div>
  )
}

/**
 * Registered as `work_order:history` — standalone visit History section: the
 * same `ScheduleVisitRow`s capped at PREVIEW_LIMIT, with the rest revealed by an
 * inline "Show more" expand. The section heading comes from the surrounding
 * `<Section>` — no block header here.
 */
export function VisitHistorySection({ recordId }: DetailViewTabProps) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const [, setPanel] = useQueryState('panel')
  const [, setItem] = useQueryState('item')

  const { history } = splitJobVisits(visits)

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
    <TreeRowList
      items={history}
      getKey={(visit) => visit.id}
      visibleLimit={PREVIEW_LIMIT}
      className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}
      renderRow={(visit) => (
        <ScheduleVisitRow
          visit={visit}
          canEdit={canEdit}
          mutations={mutations}
          existingVisits={existingVisits}
          workOrderRecordId={recordId}
          onRefresh={refresh}
          onOpen={() => openItem(visit.id)}
        />
      )}
    />
  )
}

export default JobScheduleSection
