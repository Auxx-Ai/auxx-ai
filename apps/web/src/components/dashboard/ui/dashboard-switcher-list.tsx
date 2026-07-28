// apps/web/src/components/dashboard/ui/dashboard-switcher-list.tsx

'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { toRecordId } from '@auxx/types/resource'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'

export interface DashboardSwitcherListProps {
  /** The dashboard currently open — highlighted in the list. */
  activeDashboardId: string
  /** Called when the user picks a different dashboard. */
  onSelectDashboard: (dashboardId: string) => void
  /**
   * Called when the user deletes the currently active dashboard. The host is
   * responsible for moving the user somewhere sensible (e.g. /app/dashboards).
   */
  onActiveDashboardDeleted?: () => void
}

/**
 * Reusable dashboard-switcher body — search, select, rename, delete. Mirrors
 * `KopilotSessionList`; designed to mount inside a breadcrumb dropdown popover.
 *
 * Note: must live inside a Popover (not a Radix DropdownMenu) because the
 * underlying MultiSelectPicker is built on `cmdk`, which manages its own
 * arrow-key navigation.
 */
export function DashboardSwitcherList({
  activeDashboardId,
  onSelectDashboard,
  onActiveDashboardDeleted,
}: DashboardSwitcherListProps) {
  const dashboards = api.dashboard.list.useQuery(undefined, { staleTime: 30_000 })
  const { updateDashboard, deleteDashboard } = useDashboardMutations()
  const { canAdminInstance } = useAccess()

  const dashboardOptions: SelectOption[] = useMemo(
    () => (dashboards.data ?? []).map((d) => ({ value: d.id, label: d.name })),
    [dashboards.data]
  )

  // Manage mode is a single all-or-nothing switch over the WHOLE list — the
  // picker has no per-row suppression — and both of its writes (inline rename →
  // `dashboard.update`, row × → `dashboard.delete`) are Full per instance. Same
  // rule as the bulk bar (doc 24 §A.2.6): render it only when every listed
  // dashboard passes admin, so a manage click can never 403.
  const canManage = useMemo(
    () => (dashboards.data ?? []).every((d) => canAdminInstance(toRecordId('dashboard', d.id))),
    [dashboards.data, canAdminInstance]
  )

  const prevOptionsRef = useRef<SelectOption[]>(dashboardOptions)
  useEffect(() => {
    prevOptionsRef.current = dashboardOptions
  }, [dashboardOptions])

  const handleOptionsChange = useCallback(
    (updatedOptions: SelectOption[]) => {
      const previous = prevOptionsRef.current

      for (const opt of updatedOptions) {
        const prev = previous.find((p) => p.value === opt.value)
        if (prev && prev.label !== opt.label) {
          void updateDashboard(opt.value, { name: opt.label })
        }
      }

      for (const prev of previous) {
        if (!updatedOptions.find((o) => o.value === prev.value)) {
          void deleteDashboard(prev.value)
          if (prev.value === activeDashboardId) onActiveDashboardDeleted?.()
        }
      }
    },
    [activeDashboardId, updateDashboard, deleteDashboard, onActiveDashboardDeleted]
  )

  return (
    <MultiSelectPicker
      options={dashboardOptions}
      value={[activeDashboardId]}
      onChange={() => {}}
      multi={false}
      onSelectSingle={onSelectDashboard}
      canManage={canManage}
      canAdd={false}
      manageLabel='Manage dashboards'
      placeholder='Search dashboards...'
      isLoading={dashboards.isLoading}
      onOptionsChange={handleOptionsChange}
    />
  )
}
