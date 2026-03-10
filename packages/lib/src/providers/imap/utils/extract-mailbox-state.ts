// packages/lib/src/providers/imap/utils/extract-mailbox-state.ts

import type { MailboxObject } from 'imapflow'

export function extractMailboxState(mailbox: MailboxObject): {
  uidValidity: number
  highestUid: number
  modSeq?: bigint
} {
  return {
    uidValidity: Number(mailbox.uidValidity ?? 0),
    highestUid: (mailbox.uidNext ?? 1) - 1,
    modSeq: mailbox.highestModseq ?? undefined,
  }
}
