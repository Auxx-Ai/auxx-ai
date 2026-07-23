// components/organization/types.ts
import type { OrganizationRole, SeatType } from '@auxx/database/types'

/** Organization membership data */
export type OrganizationMembership = {
  id: string
  name: string | null
  handle: string | null
  role: OrganizationRole
  seatType: SeatType
}

/** Pending invitation data */
export type PendingInvitation = {
  id: string
  role: OrganizationRole
  createdAt: Date
  expiresAt: Date
  organization: {
    id: string
    name: string | null
  }
  invitedBy: {
    id: string
    name: string | null
    image: string | null
  } | null
}
