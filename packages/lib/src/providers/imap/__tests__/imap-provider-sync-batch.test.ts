// packages/lib/src/providers/imap/__tests__/imap-provider-sync-batch.test.ts
//
// `importMessagesInSyncBatch` is the seam that puts the IMAP folder walk into
// the realtime sync-batch context (`ctx.inSyncBatch`) — the same
// `runInSyncBatch` Gmail/Outlook enter via their ingestors — so a 5,000-message
// first scan emits one `inbox:syncCompleted` per touched inbox instead of
// 5,000 per-message socket frames. The steady-state path keeps calling
// `importMessages` directly, so live IMAP mail retains per-message realtime.

import { describe, expect, it, vi } from 'vitest'

// Keep the module graph light: the ImapProvider class file pulls in imapflow /
// ldap / nodemailer service classes and the ingest pipeline via
// MessageStorageService — none of which this seam test needs.
vi.mock('../imap-client-provider', () => ({ ImapClientProvider: class {} }))
vi.mock('../imap-get-message-list', () => ({ ImapGetMessageListService: class {} }))
vi.mock('../imap-get-messages', () => ({ ImapGetMessagesService: class {} }))
vi.mock('../imap-get-all-folders', () => ({ ImapGetAllFoldersService: class {} }))
vi.mock('../imap-send-message', () => ({ ImapSmtpSendService: class {} }))
vi.mock('../ldap-auth-service', () => ({ LdapAuthService: class {} }))
vi.mock('../../../email/email-storage', () => ({ MessageStorageService: class {} }))
vi.mock('@auxx/credentials/store', () => ({ revealSecrets: vi.fn() }))

import { ImapProvider } from '../imap-provider'

describe('ImapProvider.importMessagesInSyncBatch', () => {
  it('runs importMessages inside runInSyncBatch for this org and returns its result', async () => {
    const provider = new ImapProvider('org_1')
    const events: string[] = []

    const runInSyncBatch = vi.fn(async (organizationId: string, fn: () => Promise<unknown>) => {
      events.push(`enter:${organizationId}`)
      const out = await fn()
      events.push('exit')
      return out
    })
    ;(provider as unknown as { storageService: unknown }).storageService = { runInSyncBatch }

    vi.spyOn(provider, 'importMessages').mockImplementation(async (externalIds: string[]) => {
      events.push(`import:${externalIds.join(',')}`)
      return { imported: externalIds.length, failed: 0 }
    })

    const result = await provider.importMessagesInSyncBatch(['uid-1', 'uid-2'])

    expect(result).toEqual({ imported: 2, failed: 0 })
    // The import ran INSIDE the batch context — realtime suppression covers
    // every storeMessage of the batch, and the flush happens after.
    expect(events).toEqual(['enter:org_1', 'import:uid-1,uid-2', 'exit'])
  })
})
