// packages/lib/src/providers/imap/imap-sync-service.ts

import type { ImapFlow, MailboxObject, SearchObject } from 'imapflow'
import { BadRequestError } from '../../errors'
import type { ImapSyncResult, UidWindowScanResult } from './types'
import { canUseQresync } from './utils/can-use-qresync'
import { extractMailboxState } from './utils/extract-mailbox-state'
import { parseSyncCursor } from './utils/parse-sync-cursor'

export class ImapSyncService {
  /** Sync a single folder, returning new and deleted UIDs (used for incremental sync) */
  async syncFolder(
    client: ImapFlow,
    mailbox: MailboxObject,
    previousCursorStr: string | null
  ): Promise<ImapSyncResult> {
    const previousCursor = previousCursorStr ? parseSyncCursor(previousCursorStr) : null

    const mailboxState = extractMailboxState(mailbox)

    // UID validity changed — need full resync
    if (previousCursor && previousCursor.uidValidity !== mailboxState.uidValidity) {
      throw new BadRequestError(
        `UID validity changed for mailbox (was ${previousCursor.uidValidity}, now ${mailboxState.uidValidity})`
      )
    }

    // No previous cursor = first sync — caller should use scanUidWindow() instead
    if (!previousCursor) {
      return this.fullSync(client, mailboxState)
    }

    // No new messages since last sync
    if (mailboxState.highestUid <= previousCursor.highestUid) {
      return { newUids: [], deletedUids: [], mailboxState }
    }

    // Try QRESYNC if available
    if (canUseQresync(client, previousCursor)) {
      return this.qresyncSync(client, previousCursor, mailboxState)
    }

    // Fallback to UID range
    return this.uidRangeSync(client, previousCursor, mailboxState)
  }

  /**
   * Scan a bounded UID window within a folder. Used for resumable full sync
   * instead of unbounded SEARCH ALL.
   *
   * @param windowStart - Start of UID range (inclusive)
   * @param windowEnd - End of UID range (inclusive)
   */
  async scanUidWindow(
    client: ImapFlow,
    mailbox: MailboxObject,
    windowStart: number,
    windowEnd: number
  ): Promise<UidWindowScanResult> {
    const mailboxState = extractMailboxState(mailbox)
    const uidRange = `${windowStart}:${windowEnd}`

    const searchResult = await client.search({ uid: uidRange } as SearchObject, { uid: true })

    const uids: number[] = []
    if (searchResult) {
      for (const uid of searchResult) {
        uids.push(uid)
      }
    }

    return { uids, windowStart, windowEnd, mailboxState }
  }

  private async fullSync(
    client: ImapFlow,
    mailboxState: ImapSyncResult['mailboxState']
  ): Promise<ImapSyncResult> {
    const searchResult = await client.search({ all: true }, { uid: true })
    if (!searchResult) return { newUids: [], deletedUids: [], mailboxState }

    const uids: number[] = []
    for (const uid of searchResult) {
      uids.push(uid)
    }

    return { newUids: uids, deletedUids: [], mailboxState }
  }

  private async qresyncSync(
    client: ImapFlow,
    previousCursor: { highestUid: number; modSeq?: bigint },
    mailboxState: ImapSyncResult['mailboxState']
  ): Promise<ImapSyncResult> {
    const searchCriteria: SearchObject = {
      modseq: previousCursor.modSeq,
      uid: `${previousCursor.highestUid + 1}:*`,
    } as SearchObject

    const newUids: number[] = []

    try {
      const searchResult = await client.search(searchCriteria, { uid: true })
      if (!searchResult) return { newUids: [], deletedUids: [], mailboxState }

      for (const uid of searchResult) {
        if (uid > previousCursor.highestUid) {
          newUids.push(uid)
        }
      }
    } catch {
      // QRESYNC search failed, fall back to UID range
      return this.uidRangeSync(client, previousCursor, mailboxState)
    }

    return { newUids, deletedUids: [], mailboxState }
  }

  private async uidRangeSync(
    client: ImapFlow,
    previousCursor: { highestUid: number },
    mailboxState: ImapSyncResult['mailboxState']
  ): Promise<ImapSyncResult> {
    const uidRange = `${previousCursor.highestUid + 1}:*`

    const searchResult = await client.search({ uid: uidRange } as SearchObject, { uid: true })
    if (!searchResult) return { newUids: [], deletedUids: [], mailboxState }

    const newUids: number[] = []
    for (const uid of searchResult) {
      if (uid > previousCursor.highestUid) {
        newUids.push(uid)
      }
    }

    return { newUids, deletedUids: [], mailboxState }
  }
}
