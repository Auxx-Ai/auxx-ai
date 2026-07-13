// apps/web/src/components/dispatch/ui/sidebar/workers-group.tsx

'use client'

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { SidebarGroup, SidebarGroupCollapse, SidebarMenu } from '@auxx/ui/components/sidebar'
import { UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SourceToggleRow } from '~/components/calendar/ui/source-toggle-group'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { AddWorkerDialog } from '../add-worker-dialog'
import { type BoardWorker, UNASSIGNED_RESOURCE_ID } from '../board/types'
import { DEFAULT_WORKER_COLOR, UNASSIGNED_COLOR } from '../board/utils'

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
 * Sidebar Workers group (v3 sidebar plan §1.2, refactored onto the global `SidebarGroupHeader`/
 * `SidebarItem` primitives per plans/dispatch/v3/02-sidebar-primitives-refactor.md Phase 3) — a
 * color-dot + visibility-toggle row per worker plus a synthetic "Unassigned" row
 * (`UNASSIGNED_RESOURCE_ID`), mirroring the deleted `WorkerFilterPopover`'s exact selection
 * semantics: toggling writes the store's `hiddenWorkerIds` (inverse set — see `board/utils.ts`'s
 * `selectedWorkerIdsFromHidden` adapter for how consumers read it back as `Set<string> | null`).
 * The header's `additionalOptions` opens `AddWorkerDialog` ("New worker").
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
  const [addOpen, setAddOpen] = useState(false)

  const additionalOptions = (
    <DropdownMenuItem
      onClick={(e) => {
        e.stopPropagation()
        setAddOpen(true)
      }}>
      <UserPlus />
      New worker
    </DropdownMenuItem>
  )

  return (
    <SidebarGroup>
      <SidebarGroupHeader
        title='Workers'
        isOpen={open}
        toggleOpen={() => onOpenChange(!open)}
        isEditMode={false}
        onToggleEditMode={() => {}}
        hideEditOption
        additionalOptions={additionalOptions}
      />
      <SidebarGroupCollapse open={open}>
        <SidebarMenu>
          {workers.map((worker) => (
            <SourceToggleRow
              key={worker.id}
              id={worker.id}
              label={worker.user?.name ?? worker.user?.email ?? 'Worker'}
              color={colorByUserId.get(worker.userId) ?? DEFAULT_WORKER_COLOR}
              visible={!hidden.has(worker.userId)}
              onToggle={() => onToggleWorker(worker.userId)}
            />
          ))}
          <SourceToggleRow
            id={UNASSIGNED_RESOURCE_ID}
            label='Unassigned'
            color={UNASSIGNED_COLOR}
            visible={!hidden.has(UNASSIGNED_RESOURCE_ID)}
            onToggle={() => onToggleWorker(UNASSIGNED_RESOURCE_ID)}
          />
        </SidebarMenu>
      </SidebarGroupCollapse>
      <AddWorkerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        excludeUserIds={workers.map((w) => w.userId)}
        onAdded={() => {}}
      />
    </SidebarGroup>
  )
}
