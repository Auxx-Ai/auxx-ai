// packages/lib/src/providers/imap/imap-client-provider.ts

import { createScopedLogger } from '@auxx/logger'
import { ImapFlow } from 'imapflow'
import { IMAP_CONNECTION_TIMEOUT_MS, IMAP_GREETING_TIMEOUT_MS } from './constants'
import type { ImapCredentialData } from './types'
import { parseImapConnectionError } from './utils/parse-imap-error'

const logger = createScopedLogger('imap-client')

export class ImapClientProvider {
  async getClient(credentials: ImapCredentialData): Promise<ImapFlow> {
    const { imap } = credentials

    const client = new ImapFlow({
      host: imap.host,
      port: imap.port,
      secure: imap.secure,
      auth: {
        user: imap.username,
        pass: imap.password,
      },
      logger: false,
      emitLogs: false,
      socketTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      tls: {
        rejectUnauthorized: !imap.allowUnauthorizedCerts,
      },
    })

    try {
      await client.connect()
      return client
    } catch (error) {
      logger.error('IMAP connection failed', {
        host: imap.host,
        port: imap.port,
        error: error instanceof Error ? error.message : String(error),
      })
      throw parseImapConnectionError(error)
    }
  }

  async closeClient(client: ImapFlow): Promise<void> {
    try {
      await client.logout()
    } catch {
      // Ignore logout errors
    }
  }
}
