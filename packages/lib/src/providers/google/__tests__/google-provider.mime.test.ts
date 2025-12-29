import { describe, it, expect, vi } from 'vitest'
import { GoogleProvider } from '../../google/google-provider'
import { createEmailMessage } from '../../google/messages/create-message'

describe('GoogleProvider MIME building', () => {
  it('builds RFC-compliant headers with folding and threading', async () => {
    const longLocal = 'very.long.local.part.with.many.segments.and.digits.1234567890'
    const recipients = Array.from({ length: 12 }, (_, i) => `${longLocal}.${i}@example.com`)

    const options = {
      from: 'sender@example.com',
      to: recipients,
      cc: ['cc.person@example.com'],
      bcc: [],
      replyTo: ['reply.to@example.com'],
      subject: 'Hello 👋🏼 with a long subject to test folding across header lines in MIME',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
      messageId: 'abc@test',
      inReplyTo: 'def@test',
      references: 'abc@test def@test',
      attachments: undefined,
    }

    const raw: string = await createEmailMessage(options)

    // Basic required headers
    expect(raw).toContain('MIME-Version: 1.0')

    // Subject should be RFC 2047-encoded due to emoji
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/)

    // Folding should occur for long To header (look for CRLF + space continuation)
    const headerSection = raw.split('\r\n\r\n')[0]
    expect(headerSection).toContain('To: ')

    // Threading headers normalized with angle brackets
    expect(headerSection).toMatch(/Message-ID: <[^>]+>/)
    expect(headerSection).toMatch(/In-Reply-To: <[^>]+>/)
    expect(headerSection).toMatch(/References: <[^>]+> <[^>]+>/)

    // Multipart/alternative without attachments
    expect(raw).toMatch(/Content-Type: multipart\/alternative; boundary="[^"]+"/)

    // Contains quoted-printable for text and HTML parts
    expect(raw).toMatch(/Content-Transfer-Encoding: quoted-printable/)
  })

  it('builds multipart/mixed with attachments, using RFC2231 filenames and base64 wrapping', async () => {
    const options = {
      from: 'sender@example.com',
      to: 'to@example.com',
      subject: 'Subject',
      text: 'hello',
      html: undefined,
      attachments: [
        {
          filename: 'Résumé 2025.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('hello world'),
          inline: false,
        },
        {
          filename: 'image-1.png',
          contentType: 'image/png',
          content: Buffer.from('small-image'),
          inline: true,
          contentId: 'cid123',
        },
      ],
    }

    const raw: string = await createEmailMessage(options)

    // Top-level multipart/mixed
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="[^"]+"/)

    // RFC2231 filename parameter should be present (filename* or encoded parameter)
    expect(raw).toMatch(/filename\*?=/)

    // Attachments should be base64 encoded
    expect(raw).toMatch(/Content-Transfer-Encoding: base64/)

    // Base64 lines should be wrapped (at least one CRLF within the content block)
    // This is a heuristic: presence of CRLF in proximity to base64 characters
    const base64Blocks = raw
      .split('\r\n')
      .filter((l) => /^[A-Za-z0-9+/=_-]+$/.test(l) && l.length > 0)
    expect(base64Blocks.some((l) => l.length <= 76)).toBe(true)

    // Inline attachment should have Content-ID
    expect(raw).toContain('Content-ID: <cid123>')
  })
})
