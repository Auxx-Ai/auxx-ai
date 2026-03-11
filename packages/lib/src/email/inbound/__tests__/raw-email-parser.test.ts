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
})
