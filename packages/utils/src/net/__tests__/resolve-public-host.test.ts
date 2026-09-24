// packages/utils/src/net/__tests__/resolve-public-host.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }))

import { resolvePublicHost } from '../resolve-public-host'
import { BlockedAddressError } from '../safe-fetch'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('OUTBOUND_ALLOWED_CIDRS', '')
  h.lookup.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('resolvePublicHost', () => {
  it('returns the first public address and keeps the name for TLS', async () => {
    h.lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }])
    await expect(resolvePublicHost('mail.example.com')).resolves.toEqual({
      address: '93.184.215.14',
      servername: 'mail.example.com',
    })
  })

  it('refuses a name when any answer is private', async () => {
    h.lookup.mockResolvedValue([
      { address: '93.184.215.14', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    await expect(resolvePublicHost('mail.example.com')).rejects.toBeInstanceOf(BlockedAddressError)
  })

  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '[::1]',
    'fd12::1',
  ])('refuses the literal %s without a DNS call', async (host) => {
    await expect(resolvePublicHost(host)).rejects.toBeInstanceOf(BlockedAddressError)
    expect(h.lookup).not.toHaveBeenCalled()
  })

  it('accepts a public literal with no servername', async () => {
    await expect(resolvePublicHost('93.184.215.14')).resolves.toEqual({
      address: '93.184.215.14',
      servername: undefined,
    })
  })

  it('honours OUTBOUND_ALLOWED_CIDRS', async () => {
    vi.stubEnv('OUTBOUND_ALLOWED_CIDRS', '10.0.0.0/8')
    h.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    await expect(resolvePublicHost('db.internal.example')).resolves.toMatchObject({
      address: '10.0.0.5',
    })
  })
})
