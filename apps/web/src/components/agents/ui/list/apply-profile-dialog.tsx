// apps/web/src/components/agents/ui/list/apply-profile-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ProfilePicker } from '~/components/pickers/profile-picker'
import { useUser } from '~/hooks/use-user'
import {
  useAgentPermissionProfiles,
  useAgentProfileBinding,
} from '../../hooks/use-agent-permission-profiles'

interface ApplyProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The selected agents' ids. */
  agentIds: string[]
  /** Called after the run finishes (refresh the list, exit selection). */
  onDone: () => void
}

/**
 * Bulk **Apply profile to draft** for the agents list (§7).
 *
 * Writes each selected agent's *draft* binding `Agent.permissionProfileId`. It
 * does not touch any published version: every affected agent is marked
 * unpublished and keeps running its existing `AgentVersion.permissionPolicy`
 * snapshot until someone publishes it — at which point the §2.4a author clamp
 * bounds the result by whoever publishes.
 *
 * Agent-side profile assignment is OWNER/ADMIN-only (doc 14 §0.9), so the action
 * is not offered to anyone else.
 */
export function ApplyProfileDialog({
  open,
  onOpenChange,
  agentIds,
  onDone,
}: ApplyProfileDialogProps) {
  const { isAdminOrOwner } = useUser()
  const { profiles, isLoading } = useAgentPermissionProfiles()
  const { setProfile } = useAgentProfileBinding()
  const [profileId, setProfileId] = useState<string>('')
  const [isApplying, setIsApplying] = useState(false)

  // Never carry a stale selection into a fresh open.
  useEffect(() => {
    if (open) setProfileId('')
  }, [open])

  const count = agentIds.length
  const noun = `${count} agent${count === 1 ? '' : 's'}`

  // The hook already filters to `appliesTo: 'agent' | 'any'`, so every listed
  // profile is bindable and none carries a disabled reason.
  const options = useMemo(() => profiles.map((profile) => ({ profile })), [profiles])

  const handleApply = async () => {
    if (!profileId) return
    setIsApplying(true)
    let failures = 0
    for (const agentId of agentIds) {
      // Silent per item — one aggregate failure toast below beats N toasts.
      const ok = await setProfile(agentId, profileId, { silent: true })
      if (!ok) failures++
    }
    setIsApplying(false)
    if (failures > 0) {
      toastError({
        title: 'Some agents could not be updated',
        description: `${failures} of ${count} failed. Their permissions are unchanged.`,
      })
    }
    onOpenChange(false)
    onDone()
  }

  if (!isAdminOrOwner) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldCheck className='size-4' />
            Apply profile to draft
          </DialogTitle>
          <DialogDescription>
            Rebinds the draft policy of {noun}. Production is unaffected: each agent keeps running
            its published snapshot, is marked as having unpublished changes, and adopts this profile
            only when it is published.
          </DialogDescription>
        </DialogHeader>

        <ProfilePicker
          value={profileId || undefined}
          options={options}
          onChange={setProfileId}
          disabled={isLoading || isApplying}
          isLoading={isLoading}
          emptyLabel='Select a permission profile'
          triggerProps={{ variant: 'outline', className: 'w-full' }}
        />

        <p className='text-xs text-muted-foreground'>
          Publishing clamps the policy to the publisher&apos;s own access, per agent — an agent can
          never be published above the authority of the person publishing it.
        </p>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isApplying}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void handleApply()}
            loading={isApplying}
            loadingText='Applying...'
            disabled={!profileId}
            data-dialog-submit>
            Apply to {noun} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
