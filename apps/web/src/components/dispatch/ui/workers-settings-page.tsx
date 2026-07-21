// apps/web/src/components/dispatch/ui/workers-settings-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { ListCard, type ListCardMenuItem } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { CalendarOff, Eye, EyeOff, Lock, Pencil, Trash2, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { type DispatchWorkerRow, WorkerCard } from './worker-card'
import { WorkerDialog, type WorkerDialogEditPage } from './worker-dialog'
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

  // One dialog for both flows: a worker id opens it on that worker (on `initialPage`); opening
  // with null starts the create flow (member-select page) — see `WorkerDialog`.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)
  const [initialPage, setInitialPage] = useState<WorkerDialogEditPage>('profile')

  const openWorkerDialog = (workerId: string | null, page: WorkerDialogEditPage = 'profile') => {
    setSelectedWorkerId(workerId)
    setInitialPage(page)
    setDialogOpen(true)
  }

  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const setWorkerActive = api.dispatch.setWorkerActive.useMutation({
    onSuccess: () => utils.dispatch.listWorkers.invalidate(),
    onError: (error) => toastError({ title: 'Error updating worker', description: error.message }),
  })

  const removeWorker = api.dispatch.removeWorker.useMutation({
    onSuccess: () => utils.dispatch.listWorkers.invalidate(),
    onError: (error) => toastError({ title: 'Error removing worker', description: error.message }),
  })

  async function handleRemove(worker: DispatchWorkerRow) {
    const confirmed = await confirm({
      title: 'Remove worker?',
      description: `This removes "${worker.user?.name ?? 'this worker'}" from the dispatch board. Their assigned visits keep their assignee — only the board column disappears.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeWorker.mutate({ workerId: worker.id })
  }

  const workerMenuItems = (worker: DispatchWorkerRow): ListCardMenuItem[] => [
    { label: 'Edit', icon: <Pencil />, onClick: () => openWorkerDialog(worker.id) },
    {
      label: 'Time off',
      icon: <CalendarOff />,
      onClick: () => openWorkerDialog(worker.id, 'time-off'),
    },
    worker.isActive
      ? {
          label: 'Deactivate',
          icon: <EyeOff />,
          disabled: setWorkerActive.isPending,
          onClick: () => setWorkerActive.mutate({ workerId: worker.id, isActive: false }),
        }
      : {
          label: 'Activate',
          icon: <Eye />,
          disabled: setWorkerActive.isPending,
          onClick: () => setWorkerActive.mutate({ workerId: worker.id, isActive: true }),
        },
    {
      label: 'Remove worker',
      icon: <Trash2 />,
      destructive: true,
      onClick: () => handleRemove(worker),
    },
  ]

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
                  onClick={(w) => openWorkerDialog(w.id)}
                  menuItems={workerMenuItems(worker)}
                />
              ))}
              <WorkerPlaceholderCard onClick={() => openWorkerDialog(null)} />
            </WorkerGrid>
          </SettingsSection>
        )}
      </div>

      <WorkerDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setSelectedWorkerId(null)
        }}
        workerId={selectedWorkerId}
        initialPage={initialPage}
      />

      <ConfirmDialog />
    </SettingsPage>
  )
}
