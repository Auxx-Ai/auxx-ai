// apps/web/src/components/agents/ui/list/agents-bulk-bar.tsx
'use client'

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Archive, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { ApplyProfileDialog } from './apply-profile-dialog'

/**
 * Floating bulk-action bar for the agents grid — apply a permission profile to
 * the selected drafts, archive, and permanent delete.
 */
export function AgentsBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const utils = api.useUtils()
  const { isAdminOrOwner } = useUser()
  const { ConfirmDialog, run, isRunning } = useBulkRunner()
  const updateAgent = api.agent.update.useMutation()
  const deleteAgent = api.agent.delete.useMutation()
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  const noun = (n: number) => `${n} agent${n === 1 ? '' : 's'}`
  const refresh = () => {
    void utils.agent.list.invalidate()
    exit()
  }

  const actions: ActionBarAction[] = [
    {
      id: 'profile',
      label: 'Apply profile',
      icon: ShieldCheck,
      // Agent-side profile assignment is OWNER/ADMIN-only (doc 14 §0.9).
      hidden: !isAdminOrOwner,
      tooltip: 'Apply a permission profile to the selected drafts',
      disabled: isRunning || count === 0,
      onClick: () => setIsProfileOpen(true),
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: Archive,
      tooltip: 'Archive selected',
      disabled: isRunning || count === 0,
      onClick: () =>
        run(ids, (id) => updateAgent.mutateAsync({ agentId: id, archivedAt: new Date() }), {
          title: `Archive ${noun(count)}?`,
          description:
            'They will stop responding to mentions and triggers. You can restore them later.',
          confirmText: 'Archive',
          destructive: false,
          pendingLabel: 'Archiving…',
          removesItem: false,
          failureTitle: 'Some agents could not be archived',
          onDone: refresh,
        }),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      variant: 'destructive',
      tooltip: 'Delete selected permanently',
      disabled: isRunning || count === 0,
      onClick: () =>
        run(ids, (id) => deleteAgent.mutateAsync({ agentId: id }), {
          title: `Delete ${noun(count)} permanently?`,
          description:
            'The agents and their triggers will be permanently removed. This cannot be undone.',
          failureTitle: 'Some agents could not be deleted',
          onDone: refresh,
        }),
    },
  ]

  return (
    <>
      <ConfirmDialog />
      <ApplyProfileDialog
        open={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        agentIds={ids}
        onDone={refresh}
      />
      <ActionBar
        open={bulkMode || count > 0}
        onOpenChange={(open) => !open && exit()}
        selectedCount={count}
        selectedLabel='selected'
        actions={actions}
        showClose
      />
    </>
  )
}
