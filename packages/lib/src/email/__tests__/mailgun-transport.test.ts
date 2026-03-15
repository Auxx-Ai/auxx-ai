// packages/lib/src/email/__tests__/mailgun-transport.test.ts

import type Mail from 'nodemailer/lib/mailer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock helpers used to capture Mailgun interactions.
const messagesCreateMock = vi.fn()
const domainsListMock = vi.fn()

// Fake Mailgun client returned by the mocked SDK.
const fakeClient = {
  messages: {
    create: messagesCreateMock,
  },
  domains: {
    list: domainsListMock,
  },
}

vi.mock('mailgun.js', () => ({
  default: class {
    // Provide the fake client that exposes the minimal interface we rely on.
    client() {
      return fakeClient
    }
  },
}))

import { createMailgunTransport } from '../../../../email/src/transports/mailgun-transport'

describe('createMailgunTransport', () => {
  beforeEach(() => {
    messagesCreateMock.mockReset()
    domainsListMock.mockReset()
    messagesCreateMock.mockResolvedValue({ id: 'queued@example.com', message: 'Queued' })
    domainsListMock.mockResolvedValue([])
  })

  it('creates valid Mailgun payloads from nodemailer mail.data', async () => {
    const transport = createMailgunTransport({
      auth: { api_key: 'key-test', domain: 'example.com' },
    })

    const mail = {
      data: {
        from: { name: 'Support', address: 'support@example.com' },
        to: [{ name: 'User', address: 'user@example.com' }],
        subject: 'Password reset',
        text: '   ',
        html: '<p>Reset link</p>',
        attachments: [
          {
            filename: 'reset.txt',
            content: 'follow instructions',
            encoding: 'utf-8',
          },
        ],
        replyTo: 'support@example.com',
      },
      message: {
        messageId: () => '<queued@example.com>',
      },
    } as unknown as Mail.Options

    const info = await new Promise<any>((resolve, reject) => {
      transport.send(mail, (err, response) => {
        if (err) {
          reject(err)
        } else {
          resolve(response)
        }
      })
    })

    expect(info).toEqual(expect.objectContaining({ messageId: 'queued@example.com' }))
    expect(messagesCreateMock).toHaveBeenCalledTimes(1)
    const payload = messagesCreateMock.mock.calls[0][1]
    expect(payload).toMatchObject({
      from: 'Support <support@example.com>',
      to: 'User <user@example.com>',
      subject: 'Password reset',
      text: '   ',
      html: '<p>Reset link</p>',
      'h:Reply-To': 'support@example.com',
      'h:Message-Id': '<queued@example.com>',
    })
    expect(payload.attachment).toHaveLength(1)
    expect(Buffer.isBuffer(payload.attachment[0].data)).toBe(true)
  })

  it('falls back to top-level fields when mail.data is missing', async () => {
    const transport = createMailgunTransport({
      auth: { api_key: 'key-test', domain: 'example.com' },
    })

    const mail = {
      from: 'Support <support@example.com>',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Greetings',
    } as unknown as Mail.Options

    await new Promise<void>((resolve, reject) => {
      transport.send(mail, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })

    expect(messagesCreateMock).toHaveBeenCalledTimes(1)
    expect(messagesCreateMock.mock.calls[0][1]).toMatchObject({
      from: 'Support <support@example.com>',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Greetings',
    })
  })
})
