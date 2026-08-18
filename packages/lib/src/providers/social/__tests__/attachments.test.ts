// packages/lib/src/providers/social/__tests__/attachments.test.ts
//
// Meta describes an attachment two incompatible ways — `{type, payload:{url}}` on the
// webhook, `{mime_type, name, image_data{url}}` on the Graph edge — and only one of
// them is a shape anyone has captured live. This suite pins the normalisation of both
// and the refusals around the download, which is the half that touches the open
// internet with a URL that arrived over the wire.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachmentFilename,
  conversationAttachmentRefs,
  fetchSocialAttachment,
  SOCIAL_ATTACHMENT_MAX_BYTES,
  webhookAttachmentRefs,
} from '../attachments'

const CONTEXT = { platform: 'facebook' as const, messageId: 'msg_1' }

function response(body: Buffer, headers: Record<string, string>, status = 200): Response {
  return new Response(body, { status, headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webhookAttachmentRefs', () => {
  it('keeps the media kinds that have bytes behind them', () => {
    const refs = webhookAttachmentRefs({
      attachments: [
        { type: 'image', payload: { url: 'https://cdn/1.jpg', title: 'receipt' } },
        { type: 'video', payload: { url: 'https://cdn/2.mp4' } },
        { type: 'file', payload: { url: 'https://cdn/3.pdf' } },
      ],
    })

    expect(refs.map((ref) => ref.type)).toEqual(['image', 'video', 'file'])
    expect(refs[0]?.name).toBe('receipt')
  })

  it('drops the kinds that are UI payloads, not files', () => {
    // A `share` points at whatever was shared — usually an external page. Downloading
    // it stores someone else's HTML as the customer's attachment.
    expect(
      webhookAttachmentRefs({
        attachments: [
          { type: 'template', payload: { url: 'https://cdn/t' } },
          { type: 'fallback', payload: { url: 'https://example.com/article' } },
          { type: 'share', payload: { url: 'https://example.com/article' } },
          { type: 'location', payload: { title: 'Berlin' } },
        ],
      })
    ).toEqual([])
  })

  it('drops an entry with no URL, whatever it claims to be', () => {
    expect(webhookAttachmentRefs({ attachments: [{ type: 'image', payload: {} }] })).toEqual([])
    expect(webhookAttachmentRefs(undefined)).toEqual([])
  })
})

describe('conversationAttachmentRefs', () => {
  it('reads the URL out of whichever media field Graph used', () => {
    const refs = conversationAttachmentRefs({
      attachments: {
        data: [
          { image_data: { url: 'https://cdn/i' }, mime_type: 'image/png', name: 'a.png', size: 10 },
          { video_data: { url: 'https://cdn/v' } },
          { file_url: 'https://cdn/f' },
          { id: 'no-url' },
        ],
      },
    })

    expect(refs.map((ref) => [ref.type, ref.url])).toEqual([
      ['image', 'https://cdn/i'],
      ['video', 'https://cdn/v'],
      ['file', 'https://cdn/f'],
    ])
    expect(refs[0]).toMatchObject({ name: 'a.png', mimeType: 'image/png', size: 10 })
  })

  it('reads an absent connection as "no attachments", never as an error', () => {
    // This edge is the one shape in the channel nobody has captured live, so every
    // field on it has to be optional in behaviour as well as in the type.
    expect(conversationAttachmentRefs({})).toEqual([])
    expect(conversationAttachmentRefs({ attachments: {} })).toEqual([])
    expect(conversationAttachmentRefs(null)).toEqual([])
  })
})

describe('attachmentFilename', () => {
  it('names an unnamed attachment by kind and position, so a retry derives the same id', () => {
    // `deriveAttachmentId` hashes the filename; a name that varied between two
    // deliveries of one message would store the same photo twice.
    const ref = { url: 'https://lookaside.fbsbx.com/?asset_id=1', type: 'image' }
    expect(attachmentFilename(ref, 0, 'image/jpeg')).toBe('image-1.jpg')
    expect(attachmentFilename(ref, 1, 'image/jpeg')).toBe('image-2.jpg')
  })

  it('keeps a name that already carries an extension', () => {
    expect(
      attachmentFilename({ url: 'u', type: 'file', name: 'invoice.pdf' }, 0, 'application/pdf')
    ).toBe('invoice.pdf')
  })

  it('sanitises a name into something a storage key can hold', () => {
    expect(attachmentFilename({ url: 'u', type: 'file', name: '../../etc/passwd' }, 0, '')).toBe(
      '.._.._etc_passwd'
    )
  })
})

describe('fetchSocialAttachment', () => {
  it('returns the bytes and the header mime type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(Buffer.from('bytes'), { 'content-type': 'image/jpeg; charset=binary' })
      )
    )

    const result = await fetchSocialAttachment({ url: 'https://cdn/1.jpg', type: 'image' }, CONTEXT)
    expect(result?.mimeType).toBe('image/jpeg')
    expect(result?.content.toString()).toBe('bytes')
  })

  it('refuses an oversized body on the declared length, before reading it', async () => {
    const fetchMock = vi.fn(async () =>
      response(Buffer.from('x'), {
        'content-type': 'video/mp4',
        'content-length': String(SOCIAL_ATTACHMENT_MAX_BYTES + 1),
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(
      await fetchSocialAttachment({ url: 'https://cdn/1.mp4', type: 'video' }, CONTEXT)
    ).toBeNull()
  })

  it('refuses a document served in place of a file', async () => {
    // An expired CDN link answers 200 with an error page. Storing that as the
    // customer's photo is worse than storing nothing.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(Buffer.from('<html>gone</html>'), { 'content-type': 'text/html' }))
    )

    expect(
      await fetchSocialAttachment({ url: 'https://cdn/1.jpg', type: 'image' }, CONTEXT)
    ).toBeNull()
  })

  it('returns null rather than throwing on a dead link', async () => {
    // Every caller is past the point of no return — the webhook has answered 200 and
    // the backfill has committed the batch. A throw here would cost the message.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(Buffer.from(''), {}, 404))
    )
    expect(
      await fetchSocialAttachment({ url: 'https://cdn/1.jpg', type: 'image' }, CONTEXT)
    ).toBeNull()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET')
      })
    )
    expect(
      await fetchSocialAttachment({ url: 'https://cdn/1.jpg', type: 'image' }, CONTEXT)
    ).toBeNull()
  })

  it('refuses a URL pointing at our own network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(
      await fetchSocialAttachment(
        { url: 'http://169.254.169.254/latest/meta-data', type: 'file' },
        CONTEXT
      )
    ).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
