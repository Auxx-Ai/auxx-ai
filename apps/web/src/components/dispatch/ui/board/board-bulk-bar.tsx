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
import type { useBoardBulkRunner } from './hooks/use-board-bulk-runner'
import type { useBoardMutations } from './hooks/use-board-mutations'

interface BoardBulkBarProps {
  selectedVisitIds: string[]
  mutations: ReturnType<typeof useBoardMutations>
  bulkRunner: ReturnType<typeof useBoardBulkRunner>
  onClearSelection: () => void
  /** Plan 37c §5.1's Copy action — `use-board-clipboard.ts`'s `copySelection` (also what
   * Cmd+C runs; the hook owns that keybinding, this button is just a visible affordance for
   * the same action, not a second registration). */
  onCopySelection: () => void
}

const noun = (n: number) => `${n} visit${n === 1 ? '' : 's'}`

/**
 * The board's floating bulk-action bar (plan 37c §5.1) — mounted unconditionally by
 * `dispatch-board.tsx` (only while `canEdit`, member boards never render it) so the
 * Delete/Backspace hotkey below stays live at a single-visit selection too, even though the
 * visible `ActionBar` itself only opens at 2+ (a plain single click keeps today's
 * chip+popover behavior, no bar noise). Every action is a sequential loop
 * (`useBoardBulkRunner`) over the SAME single-visit mutations `use-board-mutations.ts`
 * already exposes — no new endpoints, no series-scope chooser (bulk = "this visit" edits).
 */
export function BoardBulkBar({
  selectedVisitIds,
  mutations,
  bulkRunner,
  onClearSelection,
  onCopySelection,
}: BoardBulkBarProps) {
  const { run, isRunning, ConfirmDialog } = bulkRunner
  const count = selectedVisitIds.length
  const hasSelection = count > 0
  const open = count >= 2

  const handleAssign = useCallback(
    (assigneeUserId: string | null) => {
      void run(
        selectedVisitIds,
        (visitId) => mutations.assignVisit.mutateAsync({ visitId, assigneeUserId }),
        {
          failureTitle: 'Some visits could not be assigned',
          failureNoun: 'visits',
        }
      )
    },
    [run, selectedVisitIds, mutations.assignVisit]
  )

  const handleDispatch = useCallback(() => {
    void run(selectedVisitIds, (visitId) => mutations.dispatchVisit.mutateAsync({ visitId }), {
      failureTitle: 'Some visits could not be dispatched',
      failureNoun: 'visits',
    })
  }, [run, selectedVisitIds, mutations.dispatchVisit])

  const handleMoveToBacklog = useCallback(() => {
    void run(selectedVisitIds, (visitId) => mutations.unscheduleVisit.mutateAsync({ visitId }), {
      failureTitle: 'Some visits could not be moved to the backlog',
      failureNoun: 'visits',
      onDone: onClearSelection,
    })
  }, [run, selectedVisitIds, mutations.unscheduleVisit, onClearSelection])

  const handleCancel = useCallback(() => {
    void run(
      selectedVisitIds,
      (visitId) => mutations.setVisitStatus.mutateAsync({ visitId, status: 'canceled' }),
      {
        confirm: {
          title: `Cancel ${noun(selectedVisitIds.length)}?`,
          description: 'This cannot be undone.',
          confirmText: 'Cancel visits',
          destructive: true,
        },
        failureTitle: 'Some visits could not be canceled',
        failureNoun: 'visits',
        onDone: onClearSelection,
      }
    )
  }, [run, selectedVisitIds, mutations.setVisitStatus, onClearSelection])

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
        props: { onSelect: handleAssign },
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
