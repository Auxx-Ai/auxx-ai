// packages/lib/src/chat/types.ts

import type { Database } from '@auxx/database'

/** Common context every chat service module takes as its first argument. */
export interface ServiceContext {
  db: Database
  organizationId: string
}

export interface VisitInfo {
  userAgent?: string
  ipAddress?: string
  referrer?: string
  url?: string
}
