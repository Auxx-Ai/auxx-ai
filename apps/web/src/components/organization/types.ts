// components/organization/types.ts
import type { OrganizationType, OrganizationRole } from '@auxx/database/types'

/** Organization membership data */
export type OrganizationMembership = {
  id: string
  name: string | null
  type: OrganizationType
  role: OrganizationRole
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
