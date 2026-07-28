// apps/web/src/components/dashboard/ui/dashboard-switcher-list.tsx
'use client'

// The dashboard breadcrumb switcher — a thin adapter over the shared
// `EntityBreadcrumbSwitcher`: run `dashboard.list`, map rows to switcher items,
// and wire favorite / settings / delete. The popover host, close-on-select,
// search, and the Favorites/All grouping all come from the shared component.
//
// Gating is per row (`canAdminInstance` on each dashboard's own record id), which
// replaces the old all-or-nothing `every()` clamp: a member who owns two of five
// listed dashboards now gets edit/delete on those two instead of on none.

import type { DashboardSummary } from '@auxx/lib/dashboards/client'
import { toRecordId } from '@auxx/types/resource'
import { Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EntityBreadcrumbSwitcher } from '~/components/pickers/entity-breadcrumb-switcher'
import type { EntitySwitcherItem } from '~/components/pickers/entity-switcher-list'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'
import { DashboardFormDialog } from './dashboard-form-dialog'

export interface DashboardSwitcherListProps {
  /** The dashboard currently open — checked in the list. */
  activeDashboardId: string
  /** Trigger label for the dashboard currently open. */
  activeDashboardName: string
  /** Called when the user picks a different dashboard. */
  onSelectDashboard: (dashboardId: string) => void
  /**
   * Called when the user deletes the currently active dashboard. The host is
   * responsible for moving the user somewhere sensible (e.g. /app/dashboards).
   */
  onActiveDashboardDeleted?: () => void
}

/**
 * The dashboard switcher mounted in the page breadcrumb: search, select,
 * favorite, open settings, and delete (with a confirm) across every dashboard
 * the viewer can see.
 */
export function DashboardSwitcherList({
  activeDashboardId,
  activeDashboardName,
  onSelectDashboard,
  onActiveDashboardDeleted,
}: DashboardSwitcherListProps) {
  const dashboards = api.dashboard.list.useQuery(undefined, { staleTime: 30_000 })
  const { deleteDashboard } = useDashboardMutations()
  const { canAdminInstance } = useAccess()

  // Settings opens the same `DashboardFormDialog` the index card's Settings item
  // uses — a real settings surface, not an inline rename. It renders as a sibling
  // of the breadcrumb popover, which has already closed itself by then.
  const [editing, setEditing] = useState<DashboardSummary | null>(null)

  const items: EntitySwitcherItem[] = useMemo(
    () =>
      (dashboards.data ?? []).map((d: DashboardSummary) => ({
        id: d.id,
        label: d.name,
        href: `/app/dashboards/${d.id}`,
        iconId: d.icon?.iconId ?? 'layout-dashboard',
        color: d.icon?.color ?? 'blue',
        secondary: d.isPrivate ? (
          <Lock className='size-3 text-muted-foreground' aria-label='Private dashboard' />
        ) : undefined,
      })),
    [dashboards.data]
  )

  const canAdmin = (item: EntitySwitcherItem) => canAdminInstance(toRecordId('dashboard', item.id))

  return (
    <>
      <EntityBreadcrumbSwitcher<'DASHBOARD'>
        activeLabel={activeDashboardName}
        items={items}
        activeId={activeDashboardId}
        isLoading={dashboards.isLoading}
        onSelect={(item) => onSelectDashboard(item.id)}
        canEdit={canAdmin}
        onEdit={(item) =>
          setEditing(
            (dashboards.data ?? []).find((d: DashboardSummary) => d.id === item.id) ?? null
          )
        }
        canDelete={canAdmin}
        onDelete={async (item) => {
          const deleted = await deleteDashboard(item.id)
          if (deleted && item.id === activeDashboardId) onActiveDashboardDeleted?.()
        }}
        deleteConfirm={(item) => ({
          title: 'Delete dashboard?',
          description: `"${item.label}" will be removed. This cannot be undone.`,
        })}
        favorite={{ targetType: 'DASHBOARD', targetIds: (item) => ({ dashboardId: item.id }) }}
        searchPlaceholder='Search dashboards...'
        emptyText='No dashboards'
      />

      <DashboardFormDialog
        dashboard={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  )
}
