// packages/lib/src/email/inbound/__tests__/sender-allowlist-guard.test.ts

import { describe, expect, it } from 'vitest'
import { assertSenderAllowed } from '../sender-allowlist-guard'

describe('assertSenderAllowed', () => {
  it('allows exact sender matches', () => {
    expect(() => {
      assertSenderAllowed('alice@example.com', ['alice@example.com'])
    }).not.toThrow()
  })

  it('allows non-public wildcard domain matches', () => {
    expect(() => {
      assertSenderAllowed('agent@partner.org', ['*@partner.org'])
    }).not.toThrow()
  })

  it('rejects senders not on the allowlist', () => {
    expect(() => {
      assertSenderAllowed('mallory@example.com', ['alice@example.com'])
    }).toThrow(/not allowed/i)
  })

  it('rejects wildcard entries for public mailbox domains', () => {
    expect(() => {
      assertSenderAllowed('alice@gmail.com', ['*@gmail.com'])
    }).toThrow(/public mailbox domains/i)
  })
})
