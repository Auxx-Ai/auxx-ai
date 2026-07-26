// apps/web/src/components/members/types.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'

/** An active organization member (as returned by `api.member.all`). */
export interface Member {
  id: string
  userId: string
  organizationId: string
  role: OrganizationRole
  seatType: SeatType
  /**
   * The bound permission profile (doc 19 §1.1). `null`/absent resolves to the
   * system template for (role, seat) exactly as the server does (§1.3).
   *
   * TODO(plan-19-step-8): optional because `member.all` does not project it yet —
   * the cached member row already carries it (`members-provider.ts`), the router
   * mapping simply drops it. Until that one field is added, an explicitly bound
   * CUSTOM profile reads on these surfaces as the system template.
   */
  permissionProfileId?: string | null
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
