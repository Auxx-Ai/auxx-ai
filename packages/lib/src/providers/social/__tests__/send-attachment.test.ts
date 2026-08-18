// packages/lib/src/providers/social/__tests__/send-attachment.test.ts
//
// The attachment send is a multipart POST whose field names are load-bearing: Meta
// accepts the HTTP request either way and then delivers a message with no
// attachment on it, so a wrong field name is a silent product failure rather than
// an error. These tests read the form back off a stubbed `fetch`.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendAttachment, sendAttachmentTypeForMimeType } from '../api'

const BASE = {
  pageId: '869289333164075',
  pageAccessToken: 'page_token',
  recipientId: '27893553143563440',
  content: Buffer.from('bytes'),
  filename: 'receipt.png',
  contentType: 'image/png',
}

function stubFetch() {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ message_id: 'm_sent_1', recipient_id: BASE.recipientId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The multipart body of the single call the stub recorded. */
async function sentForm(fetchMock: ReturnType<typeof stubFetch>): Promise<FormData> {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return init.body as FormData
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendAttachmentTypeForMimeType', () => {
  it('maps a MIME type to the word Meta renders by', () => {
    // Meta renders by this word, not the MIME type: a JPEG sent as `file` arrives
    // as a download link instead of a photo.
    expect(sendAttachmentTypeForMimeType('image/jpeg')).toBe('image')
    expect(sendAttachmentTypeForMimeType('IMAGE/PNG')).toBe('image')
    expect(sendAttachmentTypeForMimeType('video/mp4')).toBe('video')
    expect(sendAttachmentTypeForMimeType('audio/mpeg')).toBe('audio')
    expect(sendAttachmentTypeForMimeType('application/pdf')).toBe('file')
    expect(sendAttachmentTypeForMimeType('')).toBe('file')
  })
})

describe('sendAttachment', () => {
  it('uploads the bytes as multipart and returns the mid', async () => {
    const fetchMock = stubFetch()

    const result = await sendAttachment(BASE)

    expect(result.messageId).toBe('m_sent_1')
    const form = await sentForm(fetchMock)
    expect(JSON.parse(form.get('recipient') as string)).toEqual({ id: BASE.recipientId })
    expect(form.get('messaging_type')).toBe('RESPONSE')
    expect(JSON.parse(form.get('message') as string)).toEqual({
      attachment: { type: 'image', payload: { is_reusable: false } },
    })

    // `filedata` is the field name the Send API looks for. Anything else is a 200
    // with an attachment-less message.
    const file = form.get('filedata') as File
    expect(file).toBeInstanceOf(Blob)
    expect(file.type).toBe('image/png')
    expect(await file.text()).toBe('bytes')
  })

  it('lets fetch set its own Content-Type so the multipart boundary matches', async () => {
    const fetchMock = stubFetch()

    await sendAttachment(BASE)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer page_token')
  })

  it('carries the tag when the send is outside the 24h window', async () => {
    const fetchMock = stubFetch()

    await sendAttachment({ ...BASE, messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })

    const form = await sentForm(fetchMock)
    expect(form.get('messaging_type')).toBe('MESSAGE_TAG')
    expect(form.get('tag')).toBe('HUMAN_AGENT')
  })

  it('omits the tag entirely on an ordinary response', async () => {
    const fetchMock = stubFetch()

    await sendAttachment(BASE)

    // Sending `tag: undefined` as the literal string "undefined" is rejected by
    // Graph with a message that names the tag, not the field.
    expect((await sentForm(fetchMock)).has('tag')).toBe(false)
  })

  it('surfaces a Graph rejection as an AuxxError, not a silent success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: 'Attachment size exceeds allowable limit', code: 100 },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
      )
    )

    await expect(sendAttachment(BASE)).rejects.toThrow('Attachment size exceeds allowable limit')
  })
})
