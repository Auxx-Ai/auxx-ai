// apps/web/src/components/dispatch/ui/worker-hours-page.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { WeeklyHoursEditor } from '~/components/availability/ui/weekly-hours-editor'
import type { WorkerHoursDraftApi } from '../hooks/use-worker-hours-draft'

interface WorkerHoursPageProps {
  hours: WorkerHoursDraftApi
  weekStartsOn: 0 | 1 | 6
  use24HourTime: boolean
}

/**
 * Worker Hours page (05-availability.md §E.2 decision 8): the "Use organization default"
 * switch over a weekly-hours editor (read-only while inheriting). Purely presentational —
 * the draft, toggle/discard logic, and the footer Save wiring live in `useWorkerHoursDraft`
 * at the dialog level so edits survive `DialogNavPages` unmounting this page on a tab switch.
 */
export function WorkerHoursPage({ hours, weekStartsOn, use24HourTime }: WorkerHoursPageProps) {
  return (
    <div className='flex flex-col gap-4 p-4'>
      <ToggleCard
        title='Use organization default'
        description="Follow the org's weekly hours, or set custom hours for this worker."
        checked={hours.useOrgDefault}
        onCheckedChange={hours.toggleUseOrgDefault}
        switchSize='xs'
        disabled={hours.loading}
      />

      {hours.loading ? (
        <Skeleton className='h-48 w-full rounded-xl' />
      ) : (
        <WeeklyHoursEditor
          value={hours.editorValue}
          onChange={hours.setWeekly}
          weekStartsOn={weekStartsOn}
          use24HourTime={use24HourTime}
          readOnly={hours.useOrgDefault}
        />
      )}
    </div>
  )
}
