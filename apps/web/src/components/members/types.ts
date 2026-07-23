// apps/web/src/components/members/types.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'

/** An active organization member (as returned by `api.member.all`). */
export interface Member {
  id: string
  userId: string
  organizationId: string
  role: OrganizationRole
  seatType: SeatType
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
  }
}

/** A pending invitation (as returned by `api.member.invitations`). */
export interface PendingInvitation {
  id: string
  email: string
  role: OrganizationRole
  createdAt: Date
  expiresAt: Date
  invitedBy: {
    name: string | null
    id: string
  } | null
}

/** A row in the Members tab — either an active member or a pending invite. */
export type DisplayMember =
  | { type: 'member'; data: Member }
  | { type: 'pending'; data: PendingInvitation }
