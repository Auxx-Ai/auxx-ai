// apps/web/src/components/members/ui/members-bulk-bar.tsx
'use client'

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { toastError } from '@auxx/ui/components/toast'
import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  useBulkMode,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useAssignProfile, useMemberProfiles } from '../hooks'
import type { Member } from '../types'
import { ApplyProfileDialog } from './apply-profile-dialog'

interface MembersBulkBarProps {
  /** Every member row currently rendered, keyed by `userId` in the selection store. */
  members: Member[]
}

/**
 * Floating bulk-action bar for the Members tab — **Apply profile** (§7).
 *
 * Assignment is not a billing event, so there is deliberately no bulk seat
 * action here: a seat change is cap-checked per member and lives in the row menu
 * (§0.21). The dialog owns the confirmation step because it shows the effective
 * delta, which is a better gate than a generic "are you sure".
 */
export function MembersBulkBar({ members }: MembersBulkBarProps) {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const addPending = useListSelection((s) => s.addPending)
  const removePending = useListSelection((s) => s.removePending)
  const setPendingLabel = useListSelection((s) => s.setPendingLabel)

  const { canManageProfiles } = useMemberProfiles()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const { assign } = useAssignProfile()

  const selected = useMemo(() => {
    const byId = new Map(members.map((m) => [m.userId, m]))
    return ids.map((id) => byId.get(id)).filter((m): m is Member => !!m)
  }, [ids, members])

  const handleApply = async (profileId: string) => {
    setPendingLabel('Applying…')
    setIsApplying(true)
    let failures = 0
    for (const member of selected) {
      addPending(member.userId)
      try {
        await assign({ memberId: member.userId, profileId })
      } catch {
        failures++
      } finally {
        // The rows stay on screen either way, so the overlay always clears.
        removePending(member.userId)
      }
    }
    setIsApplying(false)
    setDialogOpen(false)
    if (failures > 0) {
      toastError({
        title: 'Some members could not be updated',
        description: `${failures} of ${selected.length} failed.`,
      })
      return
    }
    exit()
  }

  const actions: ActionBarAction[] = [
    {
      id: 'apply-profile',
      label: 'Apply profile',
      icon: ShieldCheck,
      variant: 'outline',
      tooltip: canManageProfiles
        ? 'Bind one permission profile to the selected members'
        : 'Requires the Permissions capability',
      disabled: isApplying || count === 0 || !canManageProfiles,
      onClick: () => setDialogOpen(true),
    },
  ]

  return (
    <>
      <ActionBar
        open={bulkMode || count > 0}
        onOpenChange={(open) => !open && exit()}
        selectedCount={count}
        selectedLabel='selected'
        actions={actions}
        showClose
      />
      <ApplyProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        members={selected}
        onApply={handleApply}
        isApplying={isApplying}
      />
    </>
  )
}
