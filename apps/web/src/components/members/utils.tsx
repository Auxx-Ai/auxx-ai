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

/** Authority rank per role — mirrors `ROLE_RANK` in `@auxx/lib/members` guards. */
const ROLE_RANK: Record<OrganizationRole, number> = { OWNER: 3, ADMIN: 2, USER: 1 }

/**
 * Whether `viewer` may remove `member` — the RANK half only. The caller must
 * also hold `members.manage`; this answers "who may act on whom", not "may you
 * manage members at all".
 *
 * A line-for-line mirror of `canManageTarget` in `@auxx/lib/members`' guards
 * (plus the self check), which is the enforcing copy. Keeping the two in step
 * matters in both directions: this used to require OWNER/ADMIN outright, which
 * hid the action from a delegated `members.manage` grantee the SERVER would
 * have let through — a USER-rank actor may act on other USER-rank members.
 * There is no client-safe `@auxx/lib/members` subpath, so this stays a mirror.
 */
export function canRemoveMember(
  member: Member,
  viewerRole: OrganizationRole | null | undefined,
  viewerId: string | null | undefined
): boolean {
  if (!viewerId || !viewerRole || member.userId === viewerId) return false
  if (viewerRole === Role.OWNER) return true
  if (member.role === Role.OWNER) return false
  if (viewerRole === Role.ADMIN && member.role === Role.ADMIN) return false
  return ROLE_RANK[member.role] <= ROLE_RANK[viewerRole]
}
