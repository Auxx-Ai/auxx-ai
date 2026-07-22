// apps/web/src/components/dispatch/ui/job-schedule/job-schedule-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { History, Plus } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { Fragment, useState } from 'react'
import { DetailSectionActions, type DetailViewTabProps } from '~/components/detail-view'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { SchedulePopover } from '../schedule-popover'
import { splitJobVisits } from './job-schedule-utils'
import { RecurringEngagementCard } from './recurring-engagement-card'
import { ScheduleVisitRow } from './schedule-visit-row'
import { SeriesEndRow } from './series-end'
import { useJobVisits } from './use-job-visits'
import { VisitCard } from './visit-card'

/** Preview-row cap for the upcoming rows under the visit card. */
const PREVIEW_LIMIT = 3

/**
 * JobScheduleSection — registered as `work_order:schedule` (dispatch M2 build
 * spec §F.2/§F.3, 04 mock layout). One Schedule section carrying, top to bottom:
 * the recurrence row (recurring jobs — `RecurringEngagementCard`, which also
 * portals the engagement badge + Pause/Edit into the Section header), the
 * "Next visit" card, the remaining upcoming visits as `ScheduleVisitRow`s
 * with an inline "Show more" expand, and past visits collapsed behind an
 * "N in history" disclosure row (the work-order drawer pattern).
 */
export function JobScheduleSection({ recordId }: DetailViewTabProps) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const { values } = useSystemValues(recordId, ['work_order_job_type', 'work_order_status'], {
    autoFetch: true,
  })
  const [, setPanel] = useQueryState('panel')
  const [, setItem] = useQueryState('item')
  const [addOpen, setAddOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const jobType = (values.work_order_job_type as string | undefined) ?? 'one_off'
  const status = (values.work_order_status as string | undefined) ?? 'new'

  const { upcoming, history } = splitJobVisits(visits)
  // The primary card's target visit — also the recurring engine's "next-upcoming visit"
  // (06-recurring-engine.md §6): a one-off job can carry extra visits too (`addVisit`'s
  // deliberate exception, plan 37c decision B), so this just picks the earliest upcoming
  // one and stays jobType-agnostic. Never falls back into history (plan 30 §G.2) — no
  // upcoming visits is an empty state, not a "next visit" mislabel on a done/canceled row.
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
    // `pe-3` matches the Line-items/Billing/Communications sections' right inset
    // so every job-page section shares one right edge, clear of the scrollbar.
    <div className='flex flex-col gap-3 pe-3'>
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
          visits={visits}
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

      {/* Terminator row (plan 36 §B.3): "Series ends after Aug 18 — Extend". Makes the
       * absence of visits past the end date self-answering; renders nothing when open-ended. */}
      {jobType === 'recurring' && (
        <div className={TREE_SECONDARY_NOTRUNCATE}>
          <SeriesEndRow
            workOrderRecordId={recordId}
            canEdit={canEdit && status !== 'ended'}
            visits={visits}
            onChanged={refresh}
          />
        </div>
      )}

      {history.length > 0 && (
        <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
          <TreeRow
            icon={<History className='size-4' />}
            rowClassName='hover:bg-primary-100'
            title={
              <span className='text-sm text-muted-foreground'>{history.length} in history</span>
            }
            expandable
            isOpen={historyOpen}
            onToggleOpen={() => setHistoryOpen((open) => !open)}>
            {history.map((visit) => (
              <Fragment key={visit.id}>
                <ScheduleVisitRow
                  visit={visit}
                  canEdit={canEdit}
                  mutations={mutations}
                  existingVisits={existingVisits}
                  workOrderRecordId={recordId}
                  onRefresh={refresh}
                  onOpen={() => openItem(visit.id)}
                />
              </Fragment>
            ))}
          </TreeRow>
        </div>
      )}
    </div>
  )
}

export default JobScheduleSection
