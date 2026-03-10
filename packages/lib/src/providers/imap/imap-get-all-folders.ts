// packages/lib/src/providers/imap/imap-get-all-folders.ts

import { createScopedLogger } from '@auxx/logger'
import { ImapClientProvider } from './imap-client-provider'
import { ImapFindSentFolderService } from './imap-find-sent-folder'
import type { ImapCredentialData } from './types'

const logger = createScopedLogger('imap-folders')

export class ImapGetAllFoldersService {
  private clientProvider = new ImapClientProvider()
  private sentFolderService = new ImapFindSentFolderService()

  async getAllMessageFolders(credentials: ImapCredentialData): Promise<
    {
      externalId: string
      name: string
      isSentBox: boolean
      parentExternalId: string | null
    }[]
  > {
    const client = await this.clientProvider.getClient(credentials)

    try {
      const mailboxes = await client.list()
      const sentFolder = await this.sentFolderService.findSentFolder(client)

      const folders: {
        externalId: string
        name: string
        isSentBox: boolean
        parentExternalId: string | null
      }[] = []

      for (const mailbox of mailboxes) {
        // Skip non-selectable mailboxes (namespace containers)
        if (mailbox.flags?.has('\\Noselect') || mailbox.flags?.has('\\NonExistent')) {
          continue
        }

        const isSentBox = sentFolder?.path === mailbox.path

        folders.push({
          externalId: mailbox.path,
          name: mailbox.name,
          isSentBox,
          parentExternalId: mailbox.parentPath || null,
        })
      }

      logger.info(`Discovered ${folders.length} IMAP folders`, {
        sentFolder: sentFolder?.path,
      })

      return folders
    } finally {
      await this.clientProvider.closeClient(client)
    }
  }
}
