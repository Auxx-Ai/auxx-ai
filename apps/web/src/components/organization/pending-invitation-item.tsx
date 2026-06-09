// components/organization/pending-invitation-item.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { formatRelativeTime } from '@auxx/utils/date'
import { Building, Check } from 'lucide-react'
import Image from 'next/image'
import type { PendingInvitation } from './types'

interface PendingInvitationItemProps {
  invitation: PendingInvitation
  onAccept: () => void
  isAccepting: boolean
}

/** Displays a single pending invitation with accept action */
export function PendingInvitationItem({
  invitation,
  onAccept,
  isAccepting,
}: PendingInvitationItemProps) {
  return (
    <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
      <div className='flex grow items-center gap-3'>
        <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0'>
          {invitation.invitedBy?.image ? (
            <Image
              src={invitation.invitedBy.image}
              alt={invitation.invitedBy.name || 'Inviter'}
              width={32}
              height={32}
              className='size-8'
            />
          ) : (
            <Building className='size-4 text-primary-500' />
          )}
        </div>

        <div>
          <p className='text-sm'>
            <span className='font-medium'>{invitation.invitedBy?.name || 'Someone'}</span> invited
            you to join{' '}
            <span className='font-semibold'>
              {invitation.organization.name || 'an organization'}
            </span>{' '}
            as a(n) <span className='font-semibold'>{invitation.role}</span>.
          </p>
          <p className='text-xs text-muted-foreground'>
            Invited {formatRelativeTime(invitation.createdAt)} • Expires{' '}
            {formatRelativeTime(invitation.expiresAt)}
          </p>
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-2 self-end sm:self-center'>
        <Button
          variant='default'
          size='sm'
          onClick={onAccept}
          disabled={isAccepting}
          loading={isAccepting}
          loadingText='Accepting...'>
          <Check />
          Accept
        </Button>
      </div>
    </div>
  )
}
