// apps/web/src/components/dispatch/ui/worker-dialog.tsx
'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { useEffect, useState } from 'react'
import { ExceptionListEditor } from '~/components/availability/ui/exception-list-editor'
import { useSettings } from '~/hooks/use-settings'
import type { DispatchWorkerRow } from './worker-card'
import { WorkerHoursPage } from './worker-hours-page'
import { WorkerProfilePage } from './worker-profile-page'

type WorkerDialogPage = 'profile' | 'time-off' | 'hours'

interface WorkerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  worker: DispatchWorkerRow | null
}

/** A catalog SINGLE_SELECT value read via `getSetting` is a scalar, but normalize defensively. */
function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

/**
 * Workers dialog (04-ui.md §9 / 07-m2-build.md §E.1): three sibling `DialogNav` pages —
 * Profile, Time off, Hours — switched via the crumb trail acting as tabs (`active` on the
 * current crumb, per `dialog-nav.tsx`'s bidirectional-crumbs mode) rather than a linear drill.
 */
export function WorkerDialog({ open, onOpenChange, worker }: WorkerDialogProps) {
  const [page, setPage] = useState<WorkerDialogPage>('profile')
  const { getSetting } = useSettings({ scope: 'GENERAL' })

  // Always reopen on Profile — never mid-page from a previous session.
  useEffect(() => {
    if (open) setPage('profile')
  }, [open])

  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)
  const use24HourTime = Boolean(scalarSetting(getSetting('organization.use24HourTime')))

  if (!worker) return null

  const name = worker.user?.name || worker.user?.email || 'Worker'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title={name}
          description='Manage this dispatch worker.'
          heading={name}
          crumbs={[
            { label: 'Profile', active: page === 'profile', onClick: () => setPage('profile') },
            { label: 'Time off', active: page === 'time-off', onClick: () => setPage('time-off') },
            { label: 'Hours', active: page === 'hours', onClick: () => setPage('hours') },
          ]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='profile' size='md'>
            <WorkerProfilePage worker={worker} onRemoved={() => onOpenChange(false)} />
          </DialogNavPage>

          <DialogNavPage value='time-off' size='md'>
            <div className='p-4'>
              <ExceptionListEditor
                subject={{ type: 'worker', userId: worker.userId }}
                use24HourTime={use24HourTime}
              />
            </div>
          </DialogNavPage>

          <DialogNavPage value='hours' size='md'>
            <WorkerHoursPage
              userId={worker.userId}
              weekStartsOn={weekStartsOn}
              use24HourTime={use24HourTime}
            />
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}
