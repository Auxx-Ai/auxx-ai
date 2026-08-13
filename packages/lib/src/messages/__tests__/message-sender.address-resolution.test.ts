// packages/lib/src/messages/__tests__/message-sender.address-resolution.test.ts
//
// Direct unit coverage of the two private address-resolution helpers §6 fix #4
// split apart: `resolveOutboundEmailAddress` (rate limiter — address only, no
// contact requirement) and `resolveOutboundEmailContext` (suppression +
// List-Unsubscribe — still contact-scoped). Complements the end-to-end guard
// wiring covered in `message-sender.send-safety.test.ts`.

import { describe, expect, it, vi } from 'vitest'

/**
 * Partial mock, same rationale as the other `messages/__tests__` suites: the
 * chainable proxy backs every builder the module graph touches at import time,
 * and the schema proxy auto-vivifies every table. Nothing in this suite drives
 * a query, so no further pinning is needed.
 */
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock(),
    IntegrationProviderTypeValues: ['google', 'outlook', 'email', 'mailgun', 'imap'],
  }
})

import { MessageSenderService } from '../message-sender.service'

function createService(): any {
  return new MessageSenderService('org-1')
}

function participants(to: any) {
  return {
    from: { id: 'from-1', identifier: 'agent@auxx.ai', identifierType: 'EMAIL', role: 'FROM' },
    to: [to],
    all: [],
  }
}

describe('resolveOutboundEmailAddress (§6 fix #4 — rate limiter)', () => {
  it('returns the address for an unlinked email recipient (no entityInstanceId needed)', () => {
    const result = createService().resolveOutboundEmailAddress({
      provider: 'google',
      participants: participants({
        id: 'p-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        role: 'TO',
        // entityInstanceId intentionally omitted — unlinked recipient
      }),
    })
    expect(result).toBe('customer@example.com')
  })

  it('returns the address for a linked recipient too', () => {
    const result = createService().resolveOutboundEmailAddress({
      provider: 'google',
      participants: participants({
        id: 'p-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        role: 'TO',
        entityInstanceId: 'contact-1',
      }),
    })
    expect(result).toBe('customer@example.com')
  })

  it('returns null for a non-email provider', () => {
    const result = createService().resolveOutboundEmailAddress({
      provider: 'chat',
      participants: participants({
        id: 'p-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        role: 'TO',
      }),
    })
    expect(result).toBeNull()
  })

  it('returns null when the primary recipient is not an email identifier', () => {
    const result = createService().resolveOutboundEmailAddress({
      provider: 'google',
      participants: participants({
        id: 'p-1',
        identifier: '+15551234567',
        identifierType: 'PHONE',
        role: 'TO',
      }),
    })
    expect(result).toBeNull()
  })

  it('returns null when there is no primary recipient', () => {
    const result = createService().resolveOutboundEmailAddress({
      provider: 'google',
      participants: { from: { id: 'from-1' }, to: [], all: [] },
    })
    expect(result).toBeNull()
  })
})

describe('resolveOutboundEmailContext (suppression + List-Unsubscribe — still contact-scoped)', () => {
  it('returns null for an unlinked recipient', () => {
    const result = createService().resolveOutboundEmailContext({
      provider: 'google',
      participants: participants({
        id: 'p-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        role: 'TO',
      }),
    })
    expect(result).toBeNull()
  })

  it('returns the context for a linked recipient', () => {
    const result = createService().resolveOutboundEmailContext({
      provider: 'google',
      participants: participants({
        id: 'p-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        role: 'TO',
        entityInstanceId: 'contact-1',
      }),
    })
    expect(result).toEqual({ email: 'customer@example.com', contactEntityInstanceId: 'contact-1' })
  })

  it('returns null for a non-email provider even when linked', () => {
    const result = createService().resolveOutboundEmailContext({
      provider: 'chat',
      participants: participants({
        id: 'p-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        role: 'TO',
        entityInstanceId: 'contact-1',
      }),
    })
    expect(result).toBeNull()
  })
})
