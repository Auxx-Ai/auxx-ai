// packages/lib/src/providers/imap/utils/parse-sync-cursor.ts

import type { ImapSyncCursor } from '../types'

export function parseSyncCursor(cursorStr: string): ImapSyncCursor | null {
  try {
    const parsed = JSON.parse(cursorStr)

    if (typeof parsed.uidValidity !== 'number' || typeof parsed.highestUid !== 'number') {
      return null
    }

    return {
      uidValidity: parsed.uidValidity,
      highestUid: parsed.highestUid,
      modSeq: parsed.modSeq ? BigInt(parsed.modSeq) : undefined,
    }
  } catch {
    return null
  }
}
