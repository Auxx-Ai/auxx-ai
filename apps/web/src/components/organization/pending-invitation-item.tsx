// components/organization/pending-invitation-item.tsx
'use client'

import { Check, Building } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { formatDistanceToNow } from 'date-fns'
import Image from 'next/image'
import type { PendingInvitation } from './types'

interface PendingInvitationItemProps {
  invitation: PendingInvitation
  onAccept: () => void
  isAccepting: boolean
}

/** Formats a date as a relative time string */
function formatRelativeDate(date: Date | undefined | null): string {
  if (!date) return '-'
  try {
    const dateObj = date instanceof Date ? date : new Date(date)
    return formatDistanceToNow(dateObj, { addSuffix: true })
  } catch {
    return 'Invalid Date'
  }
}

/** Displays a single pending invitation with accept action */
export function PendingInvitationItem({
  invitation,
  onAccept,
  isAccepting,
}: PendingInvitationItemProps) {
  return (
    <div className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200">
      <div className="flex grow items-center gap-3">
        <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0">
          {invitation.invitedBy?.image ? (
            <Image
              src={invitation.invitedBy.image}
              alt={invitation.invitedBy.name || 'Inviter'}
              width={32}
              height={32}
              className="size-8"
            />
          ) : (
            <Building className="size-4 text-primary-500" />
          )}
        </div>

        <div>
          <p className="text-sm">
            <span className="font-medium">{invitation.invitedBy?.name || 'Someone'}</span> invited
            you to join{' '}
            <span className="font-semibold">
              {invitation.organization.name || 'an organization'}
            </span>{' '}
            as a(n) <span className="font-semibold">{invitation.role}</span>.
          </p>
          <p className="text-xs text-muted-foreground">
            Invited {formatRelativeDate(invitation.createdAt)} • Expires{' '}
            {formatRelativeDate(invitation.expiresAt)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
        <Button
          variant="default"
          size="sm"
          onClick={onAccept}
          disabled={isAccepting}
          loading={isAccepting}
          loadingText="Accepting...">
          <Check />
          Accept
        </Button>
      </div>
    </div>
  )
}
