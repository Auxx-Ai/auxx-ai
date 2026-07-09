// packages/lib/src/channels/types.ts

import type { Database } from '@auxx/database'

/**
 * Shared context object passed as the first arg to every channel function.
 * Functions that need a user id accept `ChannelCtx & { userId: string }` so
 * the type system enforces it at call sites.
 */
export interface ChannelCtx {
  db: Database
  organizationId: string
  userId?: string
}

/**
 * Per-channel settings persisted on `Integration.metadata.settings`.
 */
export interface ChannelSettings {
  recordCreation?: {
    mode: 'all' | 'selective' | 'none'
  }
  excludeSenders?: string[]
  excludeRecipients?: string[]
  onlyProcessRecipients?: string[]
  /**
   * Personal-inbox push-back to the provider mailbox (bidirectional status
   * sync). Absent ⇒ enabled (opt-out) — only an explicit `false` disables.
   * Only meaningful on providers whose capabilities set
   * `supportsBidirectionalStatusSync`.
   */
  bidirectionalSyncEnabled?: boolean
}
