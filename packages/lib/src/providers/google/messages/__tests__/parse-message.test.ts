// packages/lib/src/providers/google/messages/__tests__/parse-message.test.ts

import type { gmail_v1 } from 'googleapis'
import { describe, expect, it } from 'vitest'
import { extractPayloadAttachments } from '../parse-message'

function makeHeader(name: string, value: string): gmail_v1.Schema$MessagePartHeader {
  return { name, value }
}

function makePart(
  overrides: Partial<gmail_v1.Schema$MessagePart> = {}
): gmail_v1.Schema$MessagePart {
  return {
    mimeType: 'application/octet-stream',
    filename: '',
    headers: [],
    body: { size: 0 },
    ...overrides,
  }
}

describe('extractPayloadAttachments', () => {
  it('extracts small inline image with embedded body.data (no attachmentId)', () => {
    const payload = makePart({
      mimeType: 'multipart/mixed',
      body: { size: 0 },
      parts: [
        makePart({
          mimeType: 'text/html',
          body: { size: 100, data: 'PGh0bWw-' },
        }),
        makePart({
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [
            makeHeader('Content-Disposition', 'inline; filename="logo.png"'),
            makeHeader('Content-ID', '<img001@example.com>'),
          ],
          body: { size: 1024, data: 'iVBORw0KGgo' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      filename: 'logo.png',
      mimeType: 'image/png',
      size: 1024,
      inline: true,
      contentId: 'img001@example.com',
      gmailAttachmentId: null,
      embeddedData: 'iVBORw0KGgo',
    })
  })

  it('extracts large inline image with attachmentId (no embedded data)', () => {
    const payload = makePart({
      mimeType: 'multipart/related',
      parts: [
        makePart({
          mimeType: 'text/html',
          body: { size: 200 },
        }),
        makePart({
          mimeType: 'image/jpeg',
          filename: 'photo.jpg',
          headers: [
            makeHeader('Content-Disposition', 'inline; filename="photo.jpg"'),
            makeHeader('Content-ID', '<photo001@example.com>'),
          ],
          body: { size: 500000, attachmentId: 'ANGjdJ8abc123' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 500000,
      inline: true,
      contentId: 'photo001@example.com',
      gmailAttachmentId: 'ANGjdJ8abc123',
      embeddedData: null,
    })
  })

  it('extracts non-inline attachment with attachmentId', () => {
    const payload = makePart({
      mimeType: 'multipart/mixed',
      parts: [
        makePart({
          mimeType: 'text/plain',
          body: { size: 50 },
        }),
        makePart({
          mimeType: 'application/pdf',
          filename: 'invoice.pdf',
          headers: [makeHeader('Content-Disposition', 'attachment; filename="invoice.pdf"')],
          body: { size: 200000, attachmentId: 'ANGjdJ8xyz789' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 200000,
      inline: false,
      contentId: null,
      gmailAttachmentId: 'ANGjdJ8xyz789',
      embeddedData: null,
    })
  })

  it('strips angle brackets from Content-ID header', () => {
    const payload = makePart({
      mimeType: 'multipart/related',
      parts: [
        makePart({
          mimeType: 'image/gif',
          filename: 'anim.gif',
          headers: [
            makeHeader('Content-ID', '<my-cid@host.com>'),
            makeHeader('Content-Disposition', 'inline'),
          ],
          body: { size: 100, data: 'R0lGODlh' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]!.contentId).toBe('my-cid@host.com')
  })

  it('does not include text/html or text/plain body parts as attachments', () => {
    const payload = makePart({
      mimeType: 'multipart/alternative',
      parts: [
        makePart({
          mimeType: 'text/plain',
          body: { size: 50, data: 'SGVsbG8' },
        }),
        makePart({
          mimeType: 'text/html',
          body: { size: 200, data: 'PGh0bWw-' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(0)
  })

  it('treats text/html with Content-Disposition: attachment as a file part', () => {
    const payload = makePart({
      mimeType: 'multipart/mixed',
      parts: [
        makePart({
          mimeType: 'text/html',
          filename: 'report.html',
          headers: [makeHeader('Content-Disposition', 'attachment; filename="report.html"')],
          body: { size: 5000, attachmentId: 'ANGjdJ8html' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('report.html')
    expect(result[0]!.inline).toBe(false)
  })

  it('handles mixed content: multiple inline + attachment parts in nested multipart', () => {
    const payload = makePart({
      mimeType: 'multipart/mixed',
      parts: [
        makePart({
          mimeType: 'multipart/related',
          parts: [
            makePart({
              mimeType: 'multipart/alternative',
              parts: [
                makePart({ mimeType: 'text/plain', body: { size: 50 } }),
                makePart({ mimeType: 'text/html', body: { size: 200 } }),
              ],
            }),
            makePart({
              mimeType: 'image/png',
              filename: 'inline1.png',
              headers: [
                makeHeader('Content-Disposition', 'inline'),
                makeHeader('Content-ID', '<cid1@mail>'),
              ],
              body: { size: 500, data: 'aW1hZ2UxZGF0YQ' },
            }),
            makePart({
              mimeType: 'image/jpeg',
              filename: 'inline2.jpg',
              headers: [
                makeHeader('Content-Disposition', 'inline'),
                makeHeader('Content-ID', '<cid2@mail>'),
              ],
              body: { size: 80000, attachmentId: 'att_inline2' },
            }),
          ],
        }),
        makePart({
          mimeType: 'application/zip',
          filename: 'files.zip',
          headers: [makeHeader('Content-Disposition', 'attachment; filename="files.zip"')],
          body: { size: 300000, attachmentId: 'att_zip' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(3)

    // Inline 1 — small embedded
    expect(result[0]).toEqual(
      expect.objectContaining({
        filename: 'inline1.png',
        inline: true,
        contentId: 'cid1@mail',
        embeddedData: 'aW1hZ2UxZGF0YQ',
        gmailAttachmentId: null,
      })
    )

    // Inline 2 — large, needs API fetch
    expect(result[1]).toEqual(
      expect.objectContaining({
        filename: 'inline2.jpg',
        inline: true,
        contentId: 'cid2@mail',
        gmailAttachmentId: 'att_inline2',
        embeddedData: null,
      })
    )

    // Non-inline attachment
    expect(result[2]).toEqual(
      expect.objectContaining({
        filename: 'files.zip',
        inline: false,
        contentId: null,
        gmailAttachmentId: 'att_zip',
      })
    )
  })

  it('captures inline image with Content-ID but no Content-Disposition', () => {
    const payload = makePart({
      mimeType: 'multipart/related',
      parts: [
        makePart({ mimeType: 'text/html', body: { size: 100 } }),
        makePart({
          mimeType: 'image/png',
          filename: 'no-disp.png',
          headers: [makeHeader('Content-ID', '<nodispcid@example>')],
          body: { size: 2048, data: 'c21hbGxkYXRh' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]!.inline).toBe(true)
    expect(result[0]!.contentId).toBe('nodispcid@example')
    expect(result[0]!.embeddedData).toBe('c21hbGxkYXRh')
  })

  it('captures part with filename but no Content-Disposition and no attachmentId', () => {
    const payload = makePart({
      mimeType: 'multipart/mixed',
      parts: [
        makePart({
          mimeType: 'application/octet-stream',
          filename: 'mystery.bin',
          headers: [],
          body: { size: 512, data: 'ZmlsZWRhdGE' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('mystery.bin')
    expect(result[0]!.embeddedData).toBe('ZmlsZWRhdGE')
  })

  it('marks attachment-disposition parts as not inline even if Content-ID is present', () => {
    const payload = makePart({
      mimeType: 'multipart/mixed',
      parts: [
        makePart({
          mimeType: 'image/png',
          filename: 'attached-img.png',
          headers: [
            makeHeader('Content-Disposition', 'attachment; filename="attached-img.png"'),
            makeHeader('Content-ID', '<attached-cid@example>'),
          ],
          body: { size: 10000, attachmentId: 'att_attached_img' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]!.inline).toBe(false)
    expect(result[0]!.contentId).toBe('attached-cid@example')
  })

  it('returns empty array for payload with no attachment parts', () => {
    const payload = makePart({
      mimeType: 'multipart/alternative',
      parts: [
        makePart({ mimeType: 'text/plain', body: { size: 20 } }),
        makePart({ mimeType: 'text/html', body: { size: 100 } }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(0)
  })

  it('defaults filename to "attachment" and mimeType to "application/octet-stream"', () => {
    const payload = makePart({
      mimeType: 'multipart/mixed',
      parts: [
        makePart({
          mimeType: undefined as any,
          filename: '',
          headers: [makeHeader('Content-ID', '<fallback@example>')],
          body: { size: 100, data: 'dGVzdA' },
        }),
      ],
    })

    const result = extractPayloadAttachments(payload)

    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('attachment')
    expect(result[0]!.mimeType).toBe('application/octet-stream')
  })
})
