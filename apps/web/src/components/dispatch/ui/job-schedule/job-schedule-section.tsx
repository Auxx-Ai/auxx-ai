// apps/web/src/components/dispatch/ui/job-schedule/job-schedule-section.tsx
'use client'

import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { MoreHorizontal } from 'lucide-react'
import { useQueryState } from 'nuqs'
import type { DetailViewTabProps } from '~/components/detail-view'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { splitJobVisits } from './job-schedule-utils'
import { RecurringEngagementCard } from './recurring-engagement-card'
import { useJobVisits } from './use-job-visits'
import { VisitCard } from './visit-card'
import { VisitTreeRow } from './visit-tree-row'

/** Preview-row cap for the Upcoming/History sections (04-ui.md §6: "1–2 TreeRow previews"). */
const PREVIEW_LIMIT = 2

/**
 * JobScheduleSection — registered as `work_order:schedule` (dispatch M2 build
 * spec §F.2/§F.3). Rendered inside DetailViewSections' own "Schedule"
 * `<Section>` anchor, so this contributes the primary visit card (+ the
 * recurring engagement card). The Upcoming visits / History previews are their
 * own sections — see `UpcomingVisitsSection` / `VisitHistorySection` below.
 */
export function JobScheduleSection({ recordId }: DetailViewTabProps) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const { values } = useSystemValues(recordId, ['work_order_job_type', 'work_order_status'], {
    autoFetch: true,
  })
  const jobType = (values.work_order_job_type as string | undefined) ?? 'one_off'
  const status = (values.work_order_status as string | undefined) ?? 'new'

  const { upcoming } = splitJobVisits(visits)
  // The primary card's target visit — also the recurring engine's "next-upcoming visit"
  // (06-recurring-engine.md §6): one-off has exactly one, so this stays jobType-agnostic.
  const primaryVisit = upcoming[0] ?? visits[0]

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
    </div>
  )
}

/** Registered as `work_order:upcoming-visits` — standalone Upcoming visits section. */
export function UpcomingVisitsSection(props: DetailViewTabProps) {
  return <VisitPreviewSection {...props} kind='upcoming' />
}

/** Registered as `work_order:history` — standalone visit History section. */
export function VisitHistorySection(props: DetailViewTabProps) {
  return <VisitPreviewSection {...props} kind='history' />
}

/**
 * Shared body of the Upcoming/History sections: borderless VisitTreeRows capped
 * at PREVIEW_LIMIT, plus a "More" TreeRow that pushes the `?panel=visits` drill
 * (the shared nuqs params `DetailViewSections` reads). The section heading comes
 * from the surrounding `<Section>` — no block header here.
 */
function VisitPreviewSection({
  recordId,
  kind,
}: DetailViewTabProps & { kind: 'upcoming' | 'history' }) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const [, setPanel] = useQueryState('panel')
  const [, setItem] = useQueryState('item')

  const { upcoming, history } = splitJobVisits(visits)
  const list = kind === 'upcoming' ? upcoming : history
  const emptyLabel = kind === 'upcoming' ? 'No upcoming visits' : 'No past visits yet'

  const openList = () => void setPanel('visits')
  const openItem = (visitId: string) => {
    void setPanel('visits')
    void setItem(visitId)
  }

  if (isLoading && visits.length === 0) {
    return <div className='p-4 text-sm text-muted-foreground'>Loading visits...</div>
  }

  if (list.length === 0) {
    return <div className='p-4 pt-2 text-sm text-muted-foreground'>{emptyLabel}</div>
  }

  return (
    <div className={`p-4 pt-2 space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {list.slice(0, PREVIEW_LIMIT).map((visit) => (
        <VisitTreeRow
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

      {list.length > PREVIEW_LIMIT && (
        <TreeRow
          icon={<MoreHorizontal className='size-4' />}
          title={<span className='text-sm text-muted-foreground'>More</span>}
          onToggleOpen={openList}
        />
      )}
    </div>
  )
}

export default JobScheduleSection
