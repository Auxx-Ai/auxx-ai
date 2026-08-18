// packages/lib/src/messages/__tests__/split-send.test.ts
//
// The split exists to keep one invariant true: every provider message id we are
// handed back belongs to a row of ours. Meta mints one `mid` per message and takes
// `text` OR one `attachment`, so a caption with two photos is three ids — and any
// id without a row comes back as a duplicate outbound message on the next sync
// (FB/IG are in `sync-all-messages-job`). These tests pin the shape of the split
// and the field ownership that keeps the parts from stepping on each other.

import { describe, expect, it } from 'vitest'
import { splitSendForProvider } from '../split-send'
import type { SendMessageInput } from '../types/message-sending.types'

const META = { maxAttachmentsPerMessage: 1, canSendTextWithAttachment: false }
const EMAIL = {}

function input(overrides: Partial<SendMessageInput> = {}): SendMessageInput {
  return {
    userId: 'user_1',
    organizationId: 'org_1',
    integrationId: 'int_1',
    threadId: 'thread_1',
    to: [],
    ...overrides,
  }
}

describe('splitSendForProvider', () => {
  it('leaves an email send alone, however many files it carries', () => {
    const send = input({ textPlain: 'here you go', attachmentIds: ['a', 'b', 'c'] })
    expect(splitSendForProvider(send, EMAIL)).toEqual([send])
  })

  it('leaves a text-only send alone on every provider', () => {
    const send = input({ textPlain: 'hello' })
    expect(splitSendForProvider(send, META)).toEqual([send])
  })

  it('leaves a single attachment with no caption alone — it already fits', () => {
    const send = input({ attachmentIds: ['a'] })
    expect(splitSendForProvider(send, META)).toEqual([send])
  })

  it('splits a caption plus two photos into three messages, text first', () => {
    const parts = splitSendForProvider(
      input({ textPlain: 'here you go', attachmentIds: ['a', 'b'] }),
      META
    )

    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatchObject({ textPlain: 'here you go', attachmentIds: undefined })
    expect(parts[1]).toMatchObject({ textPlain: null, attachmentIds: ['a'] })
    expect(parts[2]).toMatchObject({ textPlain: null, attachmentIds: ['b'] })
  })

  it('never repeats the text on an attachment part', () => {
    // Carrying the body onto every part would send the caption three times, which
    // is exactly what the separate text part exists to prevent.
    const parts = splitSendForProvider(
      input({ textHtml: '<p>hi</p>', textPlain: 'hi', attachmentIds: ['a', 'b'] }),
      META
    )

    for (const part of parts.slice(1)) {
      expect(part.textHtml).toBeNull()
      expect(part.textPlain).toBeNull()
    }
  })

  it('splits a caption and one photo, because Meta cannot carry both in one message', () => {
    const parts = splitSendForProvider(
      input({ textPlain: 'receipt attached', attachmentIds: ['a'] }),
      META
    )

    expect(parts).toHaveLength(2)
  })

  it('gives the send-level fields to the first part only', () => {
    // A duplicated RFC Message-ID would collide, one draft is consumed once, and a
    // signature appended to an attachment-only message becomes that message's body.
    const parts = splitSendForProvider(
      input({
        textPlain: 'hi',
        attachmentIds: ['a', 'b'],
        messageId: '<generated@auxx>',
        draftMessageId: 'draft_1',
        signatureId: 'sig_1',
        includePreviousMessage: true,
      }),
      META
    )

    expect(parts[0]).toMatchObject({
      messageId: '<generated@auxx>',
      draftMessageId: 'draft_1',
      signatureId: 'sig_1',
      includePreviousMessage: true,
    })
    for (const part of parts.slice(1)) {
      expect(part.messageId).toBeUndefined()
      expect(part.draftMessageId).toBeNull()
      expect(part.signatureId).toBeNull()
      expect(part.includePreviousMessage).toBe(false)
    }
  })

  it('promotes the first attachment part when there is no text to carry them', () => {
    const parts = splitSendForProvider(
      input({ attachmentIds: ['a', 'b'], draftMessageId: 'draft_1' }),
      META
    )

    expect(parts).toHaveLength(2)
    expect(parts[0]?.draftMessageId).toBe('draft_1')
    expect(parts[1]?.draftMessageId).toBeNull()
  })

  it('treats whitespace-only text as no text, so it does not mint an empty message', () => {
    const parts = splitSendForProvider(
      input({ textPlain: '   ', textHtml: '', attachmentIds: ['a'] }),
      META
    )

    expect(parts).toHaveLength(1)
  })

  it('produces parts that are themselves unsplittable — the recursion is one level deep', () => {
    const parts = splitSendForProvider(
      input({ textPlain: 'hi', attachmentIds: ['a', 'b', 'c'] }),
      META
    )

    for (const part of parts) {
      expect(splitSendForProvider(part, META)).toEqual([part])
    }
  })
})
