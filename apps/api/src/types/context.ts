// apps/api/src/types/context.ts

import type { UserEntity } from '@auxx/database'
import type { ValidatedToken } from '../lib/jwt-validator'

/**
 * Extended Hono context with authentication data
 */
export type AppContext = {
  Variables: {
    // ─── Authentication Context ──────────────────────────────
    userId: string
    user: UserEntity
    scopes: string[]
    token: ValidatedToken

    // ─── Organization Context ────────────────────────────────
    organizationId: string
    organization: {
      id: string
      handle: string | null
      name: string | null
      type: string
      disabledAt: Date | null
      createdById: string
      [key: string]: unknown
    }
    organizationMember: {
      id: string
      userId: string
      organizationId: string
      role: string // 'USER' | 'ADMIN' | 'OWNER'
      status: string // 'ACTIVE' | 'INACTIVE'
      createdAt: Date
      updatedAt: Date
    }
    organizationRole: string // Quick access to member.role
  }
}
