// packages/lib/src/providers/imap/imap-find-sent-folder.ts

import type { ImapFlow } from 'imapflow'
import { SENT_FOLDER_PATTERNS } from './constants'

export class ImapFindSentFolderService {
  async findSentFolder(client: ImapFlow): Promise<{ path: string; name: string } | null> {
    const mailboxes = await client.list()

    // First: look for \Sent special-use flag (RFC 6154)
    for (const mailbox of mailboxes) {
      if (mailbox.specialUse === '\\Sent' || mailbox.flags?.has('\\Sent')) {
        return { path: mailbox.path, name: mailbox.name }
      }
    }

    // Fallback: regex pattern matching
    for (const mailbox of mailboxes) {
      for (const pattern of SENT_FOLDER_PATTERNS) {
        if (pattern.test(mailbox.name) || pattern.test(mailbox.path)) {
          return { path: mailbox.path, name: mailbox.name }
        }
      }
    }

    return null
  }
}
