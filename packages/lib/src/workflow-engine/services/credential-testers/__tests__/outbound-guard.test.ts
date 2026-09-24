// packages/lib/src/workflow-engine/services/credential-testers/__tests__/outbound-guard.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ resolve: vi.fn(), createTransport: vi.fn(), pgClient: vi.fn() }))

vi.mock('../../../../net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolvePublicHost: h.resolve,
}))
vi.mock('nodemailer', () => ({ default: { createTransport: h.createTransport } }))
vi.mock('pg', () => ({ default: { Client: h.pgClient }, Client: h.pgClient }))

import { BlockedAddressError } from '../../../../net/safe-fetch'
import { PostgresTester } from '../postgres-tester'
import { SmtpTester } from '../smtp-tester'

beforeEach(() => {
  vi.clearAllMocks()
  h.resolve.mockRejectedValue(new BlockedAddressError('169.254.169.254'))
})

describe('credential testers refuse private hosts', () => {
  it('postgres reports failure and never builds a client', async () => {
    const result = await PostgresTester.test({
      host: 'metadata.evil.example',
      port: 5432,
      database: 'd',
      user: 'u',
      password: 'p',
    })
    expect(result.success).toBe(false)
    expect(h.pgClient).not.toHaveBeenCalled()
  })

  it('smtp reports failure and never builds a transport', async () => {
    const result = await SmtpTester.test({
      host: 'metadata.evil.example',
      port: 587,
      username: 'u',
      password: 'p',
    })
    expect(result.success).toBe(false)
    expect(h.createTransport).not.toHaveBeenCalled()
  })
})
