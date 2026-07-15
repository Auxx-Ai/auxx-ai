// apps/web/src/components/dispatch/ui/workers-settings-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { ListCard } from '@auxx/ui/components/list-card'
import { Lock, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { AddWorkerDialog } from './add-worker-dialog'
import { type DispatchWorkerRow, WorkerCard } from './worker-card'
import { WorkerDialog } from './worker-dialog'
import { WorkerPlaceholderCard } from './worker-placeholder-card'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'Workers' }]

const GRID_CLASS = 'grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'

/** Container-query wrapper so the grid's `@md`/`@2xl` breakpoints resolve. */
function WorkerGrid({ children }: { children: ReactNode }) {
  return (
    <div className='@container'>
      <div className={GRID_CLASS}>{children}</div>
    </div>
  )
}

/**
 * Dispatch Workers settings page (04-ui.md §9, 07-m2-build.md §E.1): a `ListCard` grid of
 * `DispatchWorker` rows (the inbox-list.tsx recipe) + an add card that opens a member picker.
 * Clicking a card opens the three-page `WorkerDialog` (Profile / Time off / Hours).
 */
export function WorkersSettingsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()
  const dispatchEnabled = hasAccess(FeatureKey.dispatch)

  const { data: workers, isLoading } = api.dispatch.listWorkers.useQuery(undefined, {
    enabled: dispatchEnabled,
    staleTime: ORG_STATIC_STALE_TIME,
  })

  const [addOpen, setAddOpen] = useState(false)
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)

  if (!dispatchEnabled) {
    return (
      <SettingsPage
        title='Workers'
        description='Manage who can be scheduled on the dispatch board.'
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  // Keep the open dialog's worker fresh across cache invalidations (color/active/etc. writes).
  const selectedWorker =
    (selectedWorkerId && workers?.find((w) => w.id === selectedWorkerId)) || null

  return (
    <SettingsPage
      title='Workers'
      description='Manage who can be scheduled on the dispatch board.'
      breadcrumbs={BREADCRUMBS}>
      <div className='p-3 sm:p-6'>
        {isLoading ? (
          <SettingsSection icon={Users} title='Workers'>
            <WorkerGrid>
              {[0, 1, 2].map((i) => (
                <ListCard key={i} loading />
              ))}
            </WorkerGrid>
          </SettingsSection>
        ) : (
          <SettingsSection
            icon={Users}
            title='Workers'
            description='Active workers appear as columns on the board.'>
            <WorkerGrid>
              {(workers ?? []).map((worker: DispatchWorkerRow) => (
                <WorkerCard
                  key={worker.id}
                  worker={worker}
                  onClick={(w) => setSelectedWorkerId(w.id)}
                />
              ))}
              <WorkerPlaceholderCard onClick={() => setAddOpen(true)} />
            </WorkerGrid>
          </SettingsSection>
        )}
      </div>

      <AddWorkerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        excludeUserIds={(workers ?? []).map((w) => w.userId)}
        onAdded={(workerId) => setSelectedWorkerId(workerId)}
      />
      <WorkerDialog
        open={!!selectedWorker}
        onOpenChange={(open) => !open && setSelectedWorkerId(null)}
        worker={selectedWorker}
      />
    </SettingsPage>
  )
}
