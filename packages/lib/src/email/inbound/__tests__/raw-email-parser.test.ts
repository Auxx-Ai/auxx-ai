// packages/lib/src/email/inbound/__tests__/raw-email-parser.test.ts

import { describe, expect, it } from 'vitest'
import { RawEmailParser } from '../raw-email-parser'

/**
 * fixtureMime is a small RFC822 sample covering the fields the inbound parser needs.
 */
const fixtureMime = `From: Alice Sender <alice@example.com>
To: Acme Support <acme@mail.auxx.ai>
Cc: Bob Copy <bob@example.com>
Subject: Test inbound email
Message-ID: <message-123@example.com>
In-Reply-To: <thread-001@example.com>
References: <thread-root@example.com> <thread-001@example.com>
Date: Tue, 10 Mar 2026 22:15:00 +0000
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain; charset="utf-8"

Plain body content

--boundary123
Content-Type: text/html; charset="utf-8"

<p>Plain body content</p>

--boundary123
Content-Type: text/plain; name="note.txt"
Content-Disposition: attachment; filename="note.txt"

hello attachment
--boundary123--
`

describe('RawEmailParser', () => {
  it('parses MIME fields into the normalized inbound shape', async () => {
    const parser = new RawEmailParser()
    const parsed = await parser.parse(fixtureMime)

    expect(parsed.from).toEqual({
      address: 'alice@example.com',
      name: 'Alice Sender',
    })
    expect(parsed.to).toEqual([
      {
        address: 'acme@mail.auxx.ai',
        name: 'Acme Support',
      },
    ])
    expect(parsed.cc).toEqual([
      {
        address: 'bob@example.com',
        name: 'Bob Copy',
      },
    ])
    expect(parsed.subject).toBe('Test inbound email')
    expect(parsed.internetMessageId).toBe('<message-123@example.com>')
    expect(parsed.inReplyTo).toBe('<thread-001@example.com>')
    expect(parsed.references).toContain('<thread-root@example.com>')
    expect(parsed.textPlain).toContain('Plain body content')
    expect(parsed.textHtml).toContain('<p>Plain body content</p>')
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]).toMatchObject({
      filename: 'note.txt',
      mimeType: 'text/plain',
      inline: false,
    })
  })

  // loop-guard plan §6 supplement — `normalizeHeaders` used to run
  // `Object.entries()` over postal-mime's header ARRAY (`{ key, value }[]`)
  // rather than its entries, so every header silently vanished into array
  // indices (`{ '0': '[object Object]', ... }`). These pin the fix and the
  // `X-AuxxAi-Message-Id` extraction that depends on reading headers correctly.
  it('normalizes headers into a lowercased key → value record, not array indices', async () => {
    const parser = new RawEmailParser()
    const parsed = await parser.parse(fixtureMime)

    expect(parsed.headers.from).toBe('Alice Sender <alice@example.com>')
    expect(parsed.headers.subject).toBe('Test inbound email')
    expect(parsed.headers['0']).toBeUndefined()
  })

  it('extracts echoedMessageId from X-AuxxAi-Message-Id when present', async () => {
    const mimeWithEcho = fixtureMime.replace(
      'MIME-Version: 1.0',
      'X-AuxxAi-Message-Id: msg_abc123\r\nMIME-Version: 1.0'
    )
    const parser = new RawEmailParser()
    const parsed = await parser.parse(mimeWithEcho)

    expect(parsed.echoedMessageId).toBe('msg_abc123')
  })

  it('echoedMessageId is null when the header is absent', async () => {
    const parser = new RawEmailParser()
    const parsed = await parser.parse(fixtureMime)

    expect(parsed.echoedMessageId).toBeNull()
  })
})
