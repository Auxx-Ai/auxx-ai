// apps/web/src/components/dashboard/ui/dashboard-card.tsx
'use client'

// One dashboard tile in the index grid: a selectable ListCard with the
// Open / Duplicate / Settings / Delete menu. Owns its own settings dialog and
// confirm state, and participates in bulk selection like the workflow card.

import type { DashboardSummary } from '@auxx/lib/dashboards/client'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ListCard, renderBadgeChips } from '@auxx/ui/components/list-card'
import { pluralize } from '@auxx/utils/strings'
import { Copy, Layers, LayoutDashboard, Lock, Settings, SquareStack, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'
import { DashboardFormDialog } from './dashboard-form-dialog'

export function DashboardCard({ dashboard }: { dashboard: DashboardSummary }) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const bulkMode = useBulkMode()
  const selected = useIsSelected(dashboard.id)
  const pending = useIsPending(dashboard.id)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const { duplicateDashboard, deleteDashboard } = useDashboardMutations()

  const handleDuplicate = async () => {
    const created = await duplicateDashboard(dashboard.id)
    if (created) router.push(`/app/dashboards/${created.id}`)
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete dashboard?',
      description: `"${dashboard.name}" will be removed. This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await deleteDashboard(dashboard.id)
  }

  return (
    <>
      <ConfirmDialog />
      <ListCard
        href={`/app/dashboards/${dashboard.id}`}
        ariaLabel={dashboard.name}
        selectable
        selecting={bulkMode}
        selected={selected}
        onSelectChange={(_, e) => toggle(dashboard.id, { shiftKey: e.shiftKey })}
        pending={pending}
        pendingLabel={pendingLabel}
        title={dashboard.name}
        icon={
          <EntityIcon
            iconId={dashboard.icon?.iconId ?? 'layout-dashboard'}
            color={dashboard.icon?.color ?? 'blue'}
            className='size-4'
          />
        }
        description={dashboard.description ?? undefined}
        descriptionLines={2}
        badges={renderBadgeChips([
          ...(dashboard.visibility === 'private'
            ? [{ icon: <Lock className='size-3' />, label: 'Private' }]
            : []),
          {
            icon: <Layers className='size-3' />,
            label: `${dashboard.widgetCount} ${pluralize(dashboard.widgetCount, 'widget')}`,
          },
          {
            icon: <SquareStack className='size-3' />,
            label: `${dashboard.tabCount} ${pluralize(dashboard.tabCount, 'tab')}`,
          },
        ])}
        menu={
          <>
            <DropdownMenuItem onClick={() => router.push(`/app/dashboards/${dashboard.id}`)}>
              <LayoutDashboard />
              Open
            </DropdownMenuItem>
            <FavoriteToggleMenuItem
              targetType='DASHBOARD'
              targetIds={{ dashboardId: dashboard.id }}
            />
            <DropdownMenuItem onClick={() => void handleDuplicate()}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant='destructive' onClick={() => void handleDelete()}>
              <Trash />
              Delete
            </DropdownMenuItem>
          </>
        }
      />
      <DashboardFormDialog
        dashboard={dashboard}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  )
}
