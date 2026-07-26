// apps/web/src/components/members/ui/member-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ListCard, type ListCardMenuItem } from '@auxx/ui/components/list-card'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils/date'
import { Mail } from 'lucide-react'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import type { MemberProfile } from '../hooks'
import type { DisplayMember } from '../types'
import { getInitials, RoleIcon } from '../utils'
import { MemberProfileBadge } from './member-profile-badge'

interface MemberCardProps {
  item: DisplayMember
  /** True when this row is the signed-in user (renders a "(You)" hint). */
  isSelf: boolean
  /** Role-gated dropdown actions, computed by the parent. Omit for no menu. */
  menuItems?: ListCardMenuItem[]
  /** Whether this row may take part in bulk selection (manageable members only). */
  selectable?: boolean
  /** The member's effective profile, resolved once by the list (§4.2 badge). */
  profile?: MemberProfile
}

/** One row in the Members tab — an active member or a pending invitation. */
export function MemberCard({
  item,
  isSelf,
  menuItems,
  selectable = false,
  profile,
}: MemberCardProps) {
  const isPending = item.type === 'pending'
  const selectionId = item.type === 'member' ? item.data.userId : item.data.id

  const bulkMode = useBulkMode()
  const selected = useIsSelected(selectionId)
  const pending = useIsPending(selectionId)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

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

  // §4.2 — the profile name is the badge; the seat badge it replaced survives
  // only as the field-seat marker inside `MemberProfileBadge`.
  const badges =
    item.type === 'member' ? (
      <>
        <Badge variant='user' size='xs'>
          <RoleIcon role={item.data.role} />
          <span>{item.data.role}</span>
        </Badge>
        <MemberProfileBadge profile={profile} seatType={item.data.seatType} />
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
      selectable={selectable}
      selecting={selectable && bulkMode}
      selected={selected}
      onSelectChange={
        selectable ? (_, e) => toggle(selectionId, { shiftKey: e.shiftKey }) : undefined
      }
      pending={pending}
      pendingLabel={pendingLabel}
    />
  )
}
