// packages/lib/src/providers/imap/utils/create-sync-cursor.ts

export function createSyncCursor(mailboxState: {
  uidValidity: number
  highestUid: number
  modSeq?: bigint
}): string {
  return JSON.stringify({
    uidValidity: mailboxState.uidValidity,
    highestUid: mailboxState.highestUid,
    modSeq: mailboxState.modSeq ? mailboxState.modSeq.toString() : undefined,
  })
}
