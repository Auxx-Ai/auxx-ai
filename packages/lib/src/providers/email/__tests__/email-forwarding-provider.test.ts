// packages/lib/src/providers/email/__tests__/email-forwarding-provider.test.ts
//
// loop-guard plan §6 supplement — the SES forwarding provider now stamps
// `X-AuxxAi-Message-Id` on outbound (additive to the wire `Message-ID`, which
// this provider already sets from our own value via `params.messageId`), so
// a cross-channel echo through an intermediate that rewrites `Message-ID`
// still resolves at the org-scoped suppress-only check in `store-message.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sendEmailCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@auxx/database', () => ({
  database: {},
  schema: { Integration: {}, Organization: {} },
}))

vi.mock('@auxx/email', () => ({
  NodemailerService: {
    getInstance: () => ({
      sendEmail: vi.fn(async (options: Record<string, unknown>) => {
        h.sendEmailCalls.push(options)
        return { success: true, id: 'sent_1' }
      }),
    }),
  },
}))

import { EmailForwardingProvider } from '../email-forwarding-provider'

describe('EmailForwardingProvider — X-AuxxAi-Message-Id stamping', () => {
  beforeEach(() => {
    h.sendEmailCalls = []
  })

  function providerWithAddress(): EmailForwardingProvider {
    const provider = new EmailForwardingProvider('org_1')
    // Bypass `initialize()` (DB-backed) — directly set the private fields it
    // would otherwise resolve, matching what `sendMessage` reads.
    ;(provider as any).fromAddress = 'support@mail.auxx.ai'
    ;(provider as any).displayName = 'Support'
    return provider
  }

  it('stamps X-AuxxAi-Message-Id when internalMessageId is provided', async () => {
    const provider = providerWithAddress()

    await provider.sendMessage({
      from: 'support@mail.auxx.ai',
      to: 'customer@example.com',
      subject: 'Re: Order',
      text: 'Hello',
      internalMessageId: 'msg_abc123',
    } as any)

    expect(h.sendEmailCalls).toHaveLength(1)
    expect(h.sendEmailCalls[0]?.headers).toMatchObject({
      'X-AuxxAi-Message-Id': 'msg_abc123',
    })
  })

  it('omits the header when internalMessageId is not provided', async () => {
    const provider = providerWithAddress()

    await provider.sendMessage({
      from: 'support@mail.auxx.ai',
      to: 'customer@example.com',
      subject: 'Re: Order',
      text: 'Hello',
    } as any)

    expect(h.sendEmailCalls).toHaveLength(1)
    const headers = h.sendEmailCalls[0]?.headers as Record<string, string> | undefined
    expect(headers?.['X-AuxxAi-Message-Id']).toBeUndefined()
  })
})
