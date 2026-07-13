// apps/web/src/components/dispatch/ui/sidebar/workers-group.tsx

'use client'

import { ModuleSidebarToggleItem } from '@auxx/ui/components/module-sidebar'
import { SidebarGroup, SidebarGroupCollapse, SidebarMenu } from '@auxx/ui/components/sidebar'
import { useMemo } from 'react'
import { type BoardWorker, UNASSIGNED_RESOURCE_ID } from '../board/types'
import { DEFAULT_WORKER_COLOR, UNASSIGNED_COLOR } from '../board/utils'
import { SidebarGroupHeader } from './sidebar-group-header'

interface WorkersGroupProps {
  workers: BoardWorker[]
  /** Hex-resolved per-worker color (`use-board-data.ts`'s `colorByUserId` — the stored
   * `SelectOptionColor` id already resolved to a real hex via `getOptionColorHex`, not the raw
   * `worker.color` field, which several ids can't render directly as a CSS color). */
  colorByUserId: Map<string, string>
  hiddenWorkerIds: string[]
  onToggleWorker: (workerId: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Sidebar Workers group (v3 sidebar plan §1.2) — a color-dot + visibility-toggle row per worker
 * plus a synthetic "Unassigned" row (`UNASSIGNED_RESOURCE_ID`), mirroring the deleted
 * `WorkerFilterPopover`'s exact selection semantics: toggling writes the store's
 * `hiddenWorkerIds` (inverse set — see `board/utils.ts`'s `selectedWorkerIdsFromHidden`
 * adapter for how consumers read it back as `Set<string> | null`).
 */
export function WorkersGroup({
  workers,
  colorByUserId,
  hiddenWorkerIds,
  onToggleWorker,
  open,
  onOpenChange,
}: WorkersGroupProps) {
  const hidden = useMemo(() => new Set(hiddenWorkerIds), [hiddenWorkerIds])

  return (
    <SidebarGroup>
      <SidebarGroupHeader title='Workers' open={open} onOpenChange={onOpenChange} />
      <SidebarGroupCollapse open={open}>
        <SidebarMenu>
          {workers.map((worker) => (
            <ModuleSidebarToggleItem
              key={worker.id}
              label={worker.user?.name ?? worker.user?.email ?? 'Worker'}
              dotStyle={{
                backgroundColor: colorByUserId.get(worker.userId) ?? DEFAULT_WORKER_COLOR,
              }}
              checked={!hidden.has(worker.userId)}
              onCheckedChange={() => onToggleWorker(worker.userId)}
            />
          ))}
          <ModuleSidebarToggleItem
            label='Unassigned'
            dotStyle={{ backgroundColor: UNASSIGNED_COLOR }}
            checked={!hidden.has(UNASSIGNED_RESOURCE_ID)}
            onCheckedChange={() => onToggleWorker(UNASSIGNED_RESOURCE_ID)}
          />
        </SidebarMenu>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}
