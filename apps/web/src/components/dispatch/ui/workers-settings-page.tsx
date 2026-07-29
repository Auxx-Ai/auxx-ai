// apps/web/src/components/dispatch/ui/workers-settings-page.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { ListCard, type ListCardMenuItem } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { CalendarOff, Eye, EyeOff, Lock, Pencil, Trash2, Users, UsersRound } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { TeamCard } from './team-card'
import { TeamDialog } from './team-dialog'
import { TeamPlaceholderCard } from './team-placeholder-card'
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
  useRequireCapability(PermissionKey.settingsManage)
  const { hasAccess } = useFeatureFlags()
  const dispatchEnabled = hasAccess(FeatureKey.dispatch)

  const { data: workers, isLoading } = api.dispatch.listWorkers.useQuery(undefined, {
    enabled: dispatchEnabled,
    staleTime: ORG_STATIC_STALE_TIME,
  })
  const individualWorkers = (workers ?? []).filter((w) => w.type === 'individual')
  const teams = (workers ?? []).filter((w) => w.type === 'team')

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

  // Same one-dialog-for-both-flows shape as workers, for teams (45-teams.md §6).
  const [teamDialogOpen, setTeamDialogOpen] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  const openTeamDialog = (teamId: string | null) => {
    setSelectedTeamId(teamId)
    setTeamDialogOpen(true)
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

  async function handleRemoveTeam(team: DispatchWorkerRow) {
    const confirmed = await confirm({
      title: 'Remove team?',
      description: `This removes "${team.name ?? 'this team'}" from the dispatch board. Its assigned visits keep their assignee — only the board column disappears.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeWorker.mutate({ workerId: team.id })
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

  const teamMenuItems = (team: DispatchWorkerRow): ListCardMenuItem[] => [
    { label: 'Edit', icon: <Pencil />, onClick: () => openTeamDialog(team.id) },
    team.isActive
      ? {
          label: 'Deactivate',
          icon: <EyeOff />,
          disabled: setWorkerActive.isPending,
          onClick: () => setWorkerActive.mutate({ workerId: team.id, isActive: false }),
        }
      : {
          label: 'Activate',
          icon: <Eye />,
          disabled: setWorkerActive.isPending,
          onClick: () => setWorkerActive.mutate({ workerId: team.id, isActive: true }),
        },
    {
      label: 'Remove team',
      icon: <Trash2 />,
      destructive: true,
      onClick: () => handleRemoveTeam(team),
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
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        {isLoading ? (
          <SettingsSection icon={Users} title='Workers'>
            <WorkerGrid>
              {[0, 1, 2].map((i) => (
                <ListCard key={i} loading />
              ))}
            </WorkerGrid>
          </SettingsSection>
        ) : (
          <>
            <SettingsSection
              icon={Users}
              title='Workers'
              description='Active workers appear as columns on the board.'>
              <WorkerGrid>
                {individualWorkers.map((worker: DispatchWorkerRow) => (
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

            <SettingsSection
              icon={UsersRound}
              title='Teams'
              description='A team is one dispatchable board row made of existing individual workers.'>
              <WorkerGrid>
                {teams.map((team: DispatchWorkerRow) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    onClick={(t) => openTeamDialog(t.id)}
                    menuItems={teamMenuItems(team)}
                  />
                ))}
                <TeamPlaceholderCard onClick={() => openTeamDialog(null)} />
              </WorkerGrid>
            </SettingsSection>
          </>
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

      <TeamDialog
        open={teamDialogOpen}
        onOpenChange={(open) => {
          setTeamDialogOpen(open)
          if (!open) setSelectedTeamId(null)
        }}
        teamWorkerId={selectedTeamId}
      />

      <ConfirmDialog />
    </SettingsPage>
  )
}
