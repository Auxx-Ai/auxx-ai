// apps/web/src/components/members/ui/member-danger-section.tsx
'use client'

import type { OrganizationRole } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { Member } from '../types'
import { canRemoveMember } from '../utils'

interface MemberDangerSectionProps {
  member: Member
  viewerRole: OrganizationRole | null | undefined
  viewerId: string | null | undefined
}

/** Destructive actions for a member — remove from the organization. */
export function MemberDangerSection({ member, viewerRole, viewerId }: MemberDangerSectionProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const removeUser = api.member.remove.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Member removed' })
      utils.member.all.invalidate()
      utils.member.activeCount.invalidate()
      router.push('/app/settings/members')
    },
    onError: (error) => toastError({ title: 'Error removing member', description: error.message }),
  })

  // Hidden entirely when the viewer can't remove this member (self, or role-gated).
  if (!canRemoveMember(member, viewerRole, viewerId)) return null

  const handleRemove = async () => {
    const confirmed = await confirm({
      title: 'Remove member?',
      description: `Remove ${member.user.name || member.user.email} from this organization? They will lose all access.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeUser.mutate({ memberId: member.userId })
  }

  return (
    <SettingsSection
      icon={TriangleAlert}
      title='Danger zone'
      description='Irreversible actions for this member'>
      <div className='flex items-center justify-between gap-4 rounded-2xl border border-destructive/30 p-4'>
        <div className='min-w-0'>
          <p className='text-sm font-medium'>Remove from organization</p>
          <p className='text-sm text-muted-foreground'>
            Revoke this member's access and free their seat.
          </p>
        </div>
        <Button
          variant='destructive'
          onClick={handleRemove}
          loading={removeUser.isPending}
          loadingText='Removing...'>
          Remove member
        </Button>
      </div>
      <ConfirmDialog />
    </SettingsSection>
  )
}
