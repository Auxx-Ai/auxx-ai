// packages/lib/src/providers/imap/__tests__/imap-send-message.test.ts
//
// SMTP was the one outbound email door that never stamped
// `X-AuxxAi-Message-Id` (Gmail `create-message.ts`, Outlook `outlook-provider.ts`
// and SES `email-forwarding-provider.ts` all did), so an inbound copy of an
// IMAP channel's send arriving on another channel carried nothing tying it back
// to the row we sent. That header is what `store-message.ts` resolves into the
// `ownEcho` signal — the ONLY unconditional loop guard on the dispatch path —
// so without it IMAP orgs had no cross-channel echo detection at all.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sendMail: vi.fn() }))

vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: h.sendMail, verify: vi.fn(), close: vi.fn() }),
}))

import { ImapSmtpSendService } from '../imap-send-message'

const CREDENTIALS = {
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    username: 'user',
    password: 'pass',
    allowUnauthorizedCerts: false,
  },
} as never

async function service() {
  const svc = new ImapSmtpSendService()
  await svc.initialize(CREDENTIALS)
  return svc
}

/** The `headers` object handed to nodemailer on the most recent send. */
const sentHeaders = () => h.sendMail.mock.calls.at(-1)?.[0]?.headers ?? {}

beforeEach(() => {
  vi.clearAllMocks()
  h.sendMail.mockResolvedValue({ messageId: '<smtp-generated@example.com>' })
})

describe('ImapSmtpSendService — X-AuxxAi-Message-Id', () => {
  it('stamps our own Message.id when internalMessageId is provided', async () => {
    const svc = await service()

    await svc.sendMessage({
      from: 'support@company.com',
      to: 'customer@external.com',
      subject: 'Re: order',
      text: 'body',
      internalMessageId: 'msg_abc123',
    } as never)

    expect(sentHeaders()['X-AuxxAi-Message-Id']).toBe('msg_abc123')
  })

  it('omits the header entirely when there is no internalMessageId', async () => {
    const svc = await service()

    await svc.sendMessage({
      from: 'support@company.com',
      to: 'customer@external.com',
      subject: 'Re: order',
      text: 'body',
    } as never)

    expect(sentHeaders()).not.toHaveProperty('X-AuxxAi-Message-Id')
  })

  it('stamps it alongside the RFC 3834 automated-send headers', async () => {
    const svc = await service()

    await svc.sendMessage({
      from: 'support@company.com',
      to: 'customer@external.com',
      subject: 'Re: order',
      text: 'body',
      internalMessageId: 'msg_abc123',
      automated: true,
    } as never)

    expect(sentHeaders()).toMatchObject({
      'X-AuxxAi-Message-Id': 'msg_abc123',
      'Auto-Submitted': 'auto-replied',
      'X-Auto-Response-Suppress': 'All',
    })
  })

  it('does not disturb the Message-ID header', async () => {
    const svc = await service()

    await svc.sendMessage({
      from: 'support@company.com',
      to: 'customer@external.com',
      subject: 'Re: order',
      text: 'body',
      messageId: '<ours@company.com>',
      internalMessageId: 'msg_abc123',
    } as never)

    expect(sentHeaders()).toMatchObject({
      'Message-ID': '<ours@company.com>',
      'X-AuxxAi-Message-Id': 'msg_abc123',
    })
  })
})
