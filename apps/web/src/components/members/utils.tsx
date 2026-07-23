// apps/web/src/components/members/utils.tsx
'use client'

import { OrganizationRole as Role } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { Clock, Shield, ShieldAlert, UserCircle2 } from 'lucide-react'
import type { Member } from './types'

/** Two-letter initials from a name, falling back to the first letter of the email. */
export function getInitials(name?: string | null, email?: string | null) {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }
  return email?.[0]?.toUpperCase() || '?'
}

/** Role glyph shared by the member rows and the detail header. */
export function RoleIcon({ role }: { role: OrganizationRole | 'PENDING' }) {
  if (role === 'PENDING') return <Clock className='size-3' />
  if (role === Role.OWNER) return <ShieldAlert className='size-3' />
  if (role === Role.ADMIN) return <Shield className='size-3' />
  return <UserCircle2 className='size-3' />
}

/**
 * Whether `viewer` may remove `member` from the organization. Single source of
 * truth for the Members-tab menu and the detail-page danger zone: never self;
 * admins can't remove owners or other admins; owners can remove anyone but self.
 */
export function canRemoveMember(
  member: Member,
  viewerRole: OrganizationRole | null | undefined,
  viewerId: string | null | undefined
): boolean {
  if (!viewerId || member.userId === viewerId) return false
  if (member.role === Role.OWNER && viewerRole !== Role.OWNER) return false
  if (viewerRole === Role.ADMIN && member.role === Role.ADMIN) return false
  return viewerRole === Role.OWNER || (viewerRole === Role.ADMIN && member.role === Role.USER)
}
