// apps/web/src/components/dispatch/ui/job-schedule/visits-list-panel.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import type { RecordDrillContext } from '~/components/records/record-drill-panels'
import { splitJobVisits } from './job-schedule-utils'
import { ScheduleVisitRow } from './schedule-visit-row'
import type { JobVisit } from './use-job-visits'
import { useJobVisits } from './use-job-visits'

/**
 * VisitsListPanel — the `visits` drill panel's list level (dispatch M2 build
 * spec §F.3): every visit on this work order, `TreeRow` rows, same actions as
 * the Schedule section's previews. Written jobType-agnostic.
 */
export function VisitsListPanel({ recordId, setItemId }: RecordDrillContext) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const { upcoming, history } = splitJobVisits(visits)
  const loading = isLoading && visits.length === 0

  const renderRow = (visit: JobVisit) => (
    <ScheduleVisitRow
      visit={visit}
      canEdit={canEdit}
      mutations={mutations}
      existingVisits={existingVisits}
      workOrderRecordId={recordId}
      onRefresh={refresh}
      onOpen={() => setItemId(visit.id)}
    />
  )

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
      <div className='flex flex-col gap-4 p-3'>
        {loading && (
          <TreeRowList
            items={[]}
            loading
            skeletonCount={5}
            getKey={(v) => v.id}
            renderRow={renderRow}
            className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}
          />
        )}
        {!loading && visits.length === 0 && (
          <div className='p-6 text-center text-sm text-muted-foreground'>No visits yet.</div>
        )}

        {upcoming.length > 0 && (
          <div>
            <div className='px-1 pb-1 text-xs font-medium uppercase text-muted-foreground'>
              Upcoming
            </div>
            <TreeRowList
              items={upcoming}
              getKey={(v) => v.id}
              renderRow={renderRow}
              className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}
            />
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div className='px-1 pb-1 text-xs font-medium uppercase text-muted-foreground'>
              History
            </div>
            <TreeRowList
              items={history}
              getKey={(v) => v.id}
              renderRow={renderRow}
              className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
