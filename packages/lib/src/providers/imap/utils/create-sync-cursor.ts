// packages/lib/src/providers/imap/utils/create-sync-cursor.ts

export function createSyncCursor(mailboxState: {
  uidValidity: number
  highestUid: number
  modSeq?: bigint
}): string {
  return JSON.stringify({
    uidValidity: Number(mailboxState.uidValidity),
    highestUid: Number(mailboxState.highestUid),
    modSeq: mailboxState.modSeq != null ? String(mailboxState.modSeq) : undefined,
  })
}
