// apps/web/src/components/members/ui/member-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ListCard, type ListCardMenuItem } from '@auxx/ui/components/list-card'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils/date'
import { Mail } from 'lucide-react'
import { SeatTypeBadge } from '~/components/permissions/ui/seat-type-badge'
import type { DisplayMember } from '../types'
import { getInitials, RoleIcon } from '../utils'

interface MemberCardProps {
  item: DisplayMember
  /** True when this row is the signed-in user (renders a "(You)" hint). */
  isSelf: boolean
  /** Role-gated dropdown actions, computed by the parent. Omit for no menu. */
  menuItems?: ListCardMenuItem[]
}

/** One row in the Members tab — an active member or a pending invitation. */
export function MemberCard({ item, isSelf, menuItems }: MemberCardProps) {
  const isPending = item.type === 'pending'
  const initials =
    item.type === 'member'
      ? getInitials(item.data.user.name, item.data.user.email)
      : getInitials(undefined, item.data.email)

  const title =
    item.type === 'member' ? (
      <span className='inline-flex items-center gap-1'>
        {item.data.user.name || 'Unnamed User'}
        {isSelf && <span className='text-xs font-normal text-muted-foreground'>(You)</span>}
      </span>
    ) : (
      item.data.email
    )

  const badges =
    item.type === 'member' ? (
      <>
        <Badge variant='user' size='xs'>
          <RoleIcon role={item.data.role} />
          <span>{item.data.role}</span>
        </Badge>
        <SeatTypeBadge seatType={item.data.seatType} />
      </>
    ) : (
      <Badge variant='user' size='xs'>
        <RoleIcon role='PENDING' />
        <span>Pending {item.data.role}</span>
      </Badge>
    )

  const subtitle =
    item.type === 'member' ? (
      <span className='inline-flex items-center gap-1.5'>
        <Mail className='size-3' />
        {item.data.user.email}
      </span>
    ) : (
      <span className='inline-flex gap-2'>
        <span>Invited {formatRelativeTime(item.data.createdAt)}</span>
        <span>Expires {formatRelativeTime(item.data.expiresAt)}</span>
      </span>
    )

  return (
    <ListCard
      layout='row'
      // Members drill into their detail page; pending invites have no user yet.
      href={item.type === 'member' ? `/app/settings/members/${item.data.userId}` : undefined}
      icon={
        <span className={cn('text-xs font-medium', isPending && 'opacity-60')}>{initials}</span>
      }
      title={title}
      badges={badges}
      subtitle={subtitle}
      menuItems={menuItems}
    />
  )
}
