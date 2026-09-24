// packages/lib/src/providers/imap/__tests__/imap-client-guard.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ resolve: vi.fn(), imapFlow: vi.fn() }))

vi.mock('../../../net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolvePublicHost: h.resolve,
}))
vi.mock('imapflow', () => ({ ImapFlow: h.imapFlow }))

import { BlockedAddressError } from '../../../net/safe-fetch'
import { ImapClientProvider } from '../imap-client-provider'

const CREDENTIALS = {
  imap: {
    host: 'imap.example.com',
    port: 993,
    secure: true,
    username: 'u',
    password: 'p',
    allowUnauthorizedCerts: false,
  },
} as never

beforeEach(() => vi.clearAllMocks())

describe('ImapClientProvider — outbound host guard', () => {
  it('dials the vetted address with the hostname as TLS servername', async () => {
    h.resolve.mockResolvedValue({ address: '203.0.113.20', servername: 'imap.example.com' })
    h.imapFlow.mockImplementation(function (this: { connect: () => Promise<void> }) {
      this.connect = async () => {}
    })

    await new ImapClientProvider().getClient(CREDENTIALS)

    expect(h.imapFlow.mock.calls[0]?.[0]).toMatchObject({
      host: '203.0.113.20',
      servername: 'imap.example.com',
    })
  })

  it('refuses a private host before constructing a client', async () => {
    h.resolve.mockRejectedValue(new BlockedAddressError('10.0.0.5'))

    await expect(new ImapClientProvider().getClient(CREDENTIALS)).rejects.toBeInstanceOf(
      BlockedAddressError
    )
    expect(h.imapFlow).not.toHaveBeenCalled()
  })
})
