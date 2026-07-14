// apps/web/src/components/dispatch/ui/job-schedule/visits-list-panel.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import type { RecordDrillContext } from '~/components/records/record-drill-panels'
import { splitJobVisits } from './job-schedule-utils'
import { useJobVisits } from './use-job-visits'
import { VisitTreeRow } from './visit-tree-row'

/**
 * VisitsListPanel — the `visits` drill panel's list level (dispatch M2 build
 * spec §F.3): every visit on this work order, `TreeRow` rows, same actions as
 * the Schedule section's previews. Written jobType-agnostic.
 */
export function VisitsListPanel({ recordId, setItemId }: RecordDrillContext) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const { upcoming, history } = splitJobVisits(visits)

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
      <div className='flex flex-col gap-4 p-3'>
        {isLoading && visits.length === 0 && (
          <div className='p-6 text-sm text-muted-foreground'>Loading visits...</div>
        )}
        {!isLoading && visits.length === 0 && (
          <div className='p-6 text-center text-sm text-muted-foreground'>No visits yet.</div>
        )}

        {upcoming.length > 0 && (
          <div>
            <div className='px-1 pb-1 text-xs font-medium uppercase text-muted-foreground'>
              Upcoming
            </div>
            <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
              {upcoming.map((visit) => (
                <VisitTreeRow
                  key={visit.id}
                  visit={visit}
                  canEdit={canEdit}
                  mutations={mutations}
                  existingVisits={existingVisits}
                  workOrderRecordId={recordId}
                  onRefresh={refresh}
                  onOpen={() => setItemId(visit.id)}
                />
              ))}
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div className='px-1 pb-1 text-xs font-medium uppercase text-muted-foreground'>
              History
            </div>
            <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
              {history.map((visit) => (
                <VisitTreeRow
                  key={visit.id}
                  visit={visit}
                  canEdit={canEdit}
                  mutations={mutations}
                  existingVisits={existingVisits}
                  workOrderRecordId={recordId}
                  onRefresh={refresh}
                  onOpen={() => setItemId(visit.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
