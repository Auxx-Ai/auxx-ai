// apps/web/src/components/dispatch/ui/board/board-bulk-bar.tsx

'use client'

import {
  ActionBar,
  type ActionBarAction,
  type PickerComponentProps,
} from '@auxx/ui/components/action-bar'
import { useHotkey } from '@tanstack/react-hotkeys'
import { Ban, Copy, Inbox, Send, UserCog } from 'lucide-react'
import type { ComponentType } from 'react'
import { useCallback } from 'react'
import { BoardAssignPicker } from './board-assign-picker'
import type { BoardBulkActions } from './hooks/use-board-bulk-actions'
import type { useBoardBulkRunner } from './hooks/use-board-bulk-runner'
import type { BoardWorker } from './types'

interface BoardBulkBarProps {
  selectedVisitIds: string[]
  bulkRunner: ReturnType<typeof useBoardBulkRunner>
  /** The shared, id-parameterized bulk actions (plan 44 §6) — the same instance the chip context
   * menu drives, so both paths run the identical confirm/loop/toast behavior. */
  bulkActions: BoardBulkActions
  onClearSelection: () => void
  /** Plan 37c §5.1's Copy action — `use-board-clipboard.ts`'s `copySelection` (also what
   * Cmd+C runs; the hook owns that keybinding, this button is just a visible affordance for
   * the same action, not a second registration). */
  onCopySelection: () => void
  /** Every active dispatch worker (individuals + teams) — the "Assign to…" picker's flat list
   * (`use-board-data.ts`'s `allWorkers`). */
  workers: BoardWorker[]
}

/**
 * The board's floating bulk-action bar (plan 37c §5.1) — mounted unconditionally by
 * `dispatch-board.tsx` (only while `canEdit`, member boards never render it) so the
 * Delete/Backspace hotkey below stays live at a single-visit selection too, even though the
 * visible `ActionBar` itself only opens at 2+ (a plain single click keeps today's
 * chip+popover behavior, no bar noise). Every action runs through the shared `bulkActions`
 * (plan 44 §6) — the same runner the chip context menu uses.
 */
export function BoardBulkBar({
  selectedVisitIds,
  bulkRunner,
  bulkActions,
  onClearSelection,
  onCopySelection,
  workers,
}: BoardBulkBarProps) {
  const { isRunning, ConfirmDialog } = bulkRunner
  const count = selectedVisitIds.length
  const hasSelection = count > 0
  const open = count >= 2

  const handleAssign = useCallback(
    (assigneeWorkerId: string | null) => bulkActions.assign(selectedVisitIds, assigneeWorkerId),
    [bulkActions, selectedVisitIds]
  )

  const handleDispatch = useCallback(
    () => bulkActions.dispatch(selectedVisitIds),
    [bulkActions, selectedVisitIds]
  )

  const handleMoveToBacklog = useCallback(
    () => bulkActions.moveToBacklog(selectedVisitIds),
    [bulkActions, selectedVisitIds]
  )

  const handleCancel = useCallback(
    () => bulkActions.cancel(selectedVisitIds),
    [bulkActions, selectedVisitIds]
  )

  // Delete/Backspace → the same bulk-cancel confirm flow, for ANY non-empty selection (not
  // just when the bar itself is visible at 2+) — mirrors a single chip's popover Cancel
  // button, just keyboard-driven. `ignoreInputs` defaults `true` for single keys
  // (`@tanstack/hotkeys`), so focus in a text input/textarea/contenteditable already
  // suppresses this — the same guard `event-calendar.tsx`'s own Escape handler hand-rolls.
  useHotkey('Delete', handleCancel, { enabled: hasSelection && !isRunning })
  useHotkey('Backspace', handleCancel, { enabled: hasSelection && !isRunning })

  const actions: ActionBarAction[] = [
    {
      id: 'copy',
      label: 'Copy',
      icon: Copy,
      onClick: onCopySelection,
      disabled: isRunning,
      shortcut: '⌘C',
      tooltip: 'Copy selected visits',
    },
    {
      id: 'assign',
      label: 'Assign to…',
      icon: UserCog,
      disabled: isRunning,
      tooltip: 'Assign selected visits to a worker',
      picker: {
        // `ActionBarAction['picker']['component']` is typed as `ComponentType<PickerComponentProps>`
        // only — every consumer with a custom required prop needs this same cast (the mail
        // toolbar's `ActorPicker`/`TagPicker`/`RecordPicker` usage has the identical pre-existing
        // mismatch at `bulk-action-toolbar.tsx:323`, just uncast there).
        component: BoardAssignPicker as ComponentType<PickerComponentProps>,
        props: { workers, onSelect: handleAssign },
      },
    },
    {
      id: 'dispatch',
      label: 'Dispatch',
      icon: Send,
      onClick: handleDispatch,
      disabled: isRunning,
      tooltip: 'Notify assignees for selected visits',
    },
    {
      id: 'backlog',
      label: 'Move to backlog',
      icon: Inbox,
      onClick: handleMoveToBacklog,
      disabled: isRunning,
      tooltip: 'Unschedule selected visits back to the backlog',
    },
    {
      id: 'cancel',
      label: 'Cancel',
      icon: Ban,
      onClick: handleCancel,
      disabled: isRunning,
      variant: 'destructive',
      shortcut: 'Del',
      tooltip: 'Cancel selected visits',
    },
  ]

  return (
    <>
      <ConfirmDialog />
      <ActionBar
        open={open}
        onOpenChange={(next) => !next && onClearSelection()}
        selectedCount={count}
        selectedLabel='selected'
        actions={actions}
        showClose
      />
    </>
  )
}
