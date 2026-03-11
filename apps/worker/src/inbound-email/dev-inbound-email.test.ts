// apps/worker/src/inbound-email/dev-inbound-email.test.ts

import { describe, expect, it, vi } from 'vitest'
import { createDevInboundEmailRoutes } from './dev-inbound-email'

/**
 * rawEmailFixture is a small RFC822 sample used by the dev route tests.
 */
const rawEmailFixture = `From: Alice Sender <alice@example.com>
To: Target <target@mail.auxx.ai>
Subject: Test inbound email
Message-ID: <message-123@example.com>
Date: Tue, 10 Mar 2026 22:15:00 +0000
MIME-Version: 1.0
Content-Type: text/plain; charset="utf-8"

Hello from the dev harness.
`

describe('createDevInboundEmailRoutes', () => {
  it('accepts a raw .eml request and forwards a synthetic queue message', async () => {
    const processDevInboundEmail = vi.fn().mockResolvedValue(undefined)
    const app = createDevInboundEmailRoutes({
      processDevInboundEmail,
      createSesMessageId: () => 'dev-fixed-id',
      now: () => new Date('2026-03-11T00:00:00.000Z'),
    })

    const response = await app.request('http://localhost/dev/inbound-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-Recipients': 'Target@Mail.Auxx.Ai, Second@Mail.Auxx.Ai',
      },
      body: rawEmailFixture,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sesMessageId: 'dev-fixed-id',
      recipients: ['target@mail.auxx.ai', 'second@mail.auxx.ai'],
    })
    expect(processDevInboundEmail).toHaveBeenCalledWith({
      rawEmail: rawEmailFixture,
      queueMessage: {
        version: 1,
        provider: 'ses',
        sesMessageId: 'dev-fixed-id',
        s3Bucket: 'dev-inline',
        s3Key: 'dev/dev-fixed-id.eml',
        recipients: ['target@mail.auxx.ai', 'second@mail.auxx.ai'],
        receivedAt: '2026-03-11T00:00:00.000Z',
      },
    })
  })

  it('returns 400 when recipients are missing', async () => {
    const app = createDevInboundEmailRoutes()

    const response = await app.request('http://localhost/dev/inbound-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: rawEmailFixture,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Recipients are required via the recipients query parameter or X-Recipients header',
    })
  })

  it('returns 415 for unsupported content types', async () => {
    const app = createDevInboundEmailRoutes()

    const response = await app.request(
      'http://localhost/dev/inbound-email?recipients=test@mail.auxx.ai',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rawEmail: rawEmailFixture }),
      }
    )

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported content type. Expected one of: text/plain, message/rfc822',
    })
  })

  it('returns 422 when processing fails due to integration resolution or sender validation', async () => {
    const app = createDevInboundEmailRoutes({
      processDevInboundEmail: vi
        .fn()
        .mockRejectedValue(
          new Error('No active forwarding integration found for recipients: target@mail.auxx.ai')
        ),
    })

    const response = await app.request(
      'http://localhost/dev/inbound-email?recipients=target@mail.auxx.ai',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'message/rfc822',
        },
        body: rawEmailFixture,
      }
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'No active forwarding integration found for recipients: target@mail.auxx.ai',
    })
  })
})
