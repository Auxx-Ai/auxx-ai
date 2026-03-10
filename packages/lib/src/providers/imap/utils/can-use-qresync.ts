// packages/lib/src/providers/imap/utils/can-use-qresync.ts

import type { ImapFlow } from 'imapflow'
import type { ImapSyncCursor } from '../types'

export function canUseQresync(client: ImapFlow, cursor: ImapSyncCursor | null): boolean {
  if (!cursor || !cursor.modSeq) {
    return false
  }

  const capabilities = (client as { capabilities?: Map<string, boolean> }).capabilities

  if (!capabilities) return false

  return capabilities.has('QRESYNC') || capabilities.has('CONDSTORE')
}
