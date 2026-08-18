// packages/lib/src/providers/social/__tests__/webhook-message.test.ts

import { describe, expect, it } from 'vitest'
import { socialThreadKey } from '../thread-key'
import type { MetaWebhookMessagingEvent } from '../types'
import { convertMetaWebhookEventToMessageData } from '../webhook-message'

const PAGE_ID = '869289333164075'
const PSID = '24957012345678901'
const BASE = {
  integrationId: 'int_1',
  organizationId: 'org_1',
  pageId: PAGE_ID,
  platform: 'facebook' as const,
  metadata: { pageId: PAGE_ID, pageName: 'Auxx-Lift' },
}

function inbound(overrides: Partial<MetaWebhookMessagingEvent> = {}): MetaWebhookMessagingEvent {
  return {
    sender: { id: PSID },
    recipient: { id: PAGE_ID },
    timestamp: 1_755_000_000_000,
    message: { mid: 'm_inbound_1', text: "where's my order?" },
    ...overrides,
  }
}

describe('convertMetaWebhookEventToMessageData', () => {
  it('keys an inbound DM on the page/counterpart pair, not the sender PSID', () => {
    const result = convertMetaWebhookEventToMessageData({ event: inbound(), ...BASE })

    expect(result?.externalThreadId).toBe(socialThreadKey(PAGE_ID, PSID))
    expect(result?.externalThreadId).not.toBe(PSID)
    expect(result?.externalId).toBe('m_inbound_1')
    expect(result?.isInbound).toBe(true)
    expect(result?.from.identifier).toBe(PSID)
    expect(result?.to[0]?.identifier).toBe(PAGE_ID)
  })

  it('gives an echo the SAME thread key as the inbound message it answers', () => {
    // The regression this whole module exists for: on an echo Meta swaps sender
    // and recipient, so keying on `sender.id` filed our own replies under the page
    // id and split every conversation in two.
    const echo = inbound({
      sender: { id: PAGE_ID },
      recipient: { id: PSID },
      message: { mid: 'm_echo_1', text: 'on its way', is_echo: true },
    })

    const inboundResult = convertMetaWebhookEventToMessageData({ event: inbound(), ...BASE })
    const echoResult = convertMetaWebhookEventToMessageData({ event: echo, ...BASE })

    expect(echoResult?.externalThreadId).toBe(inboundResult?.externalThreadId)
    expect(echoResult?.isInbound).toBe(false)
    expect(echoResult?.from.identifier).toBe(PAGE_ID)
    expect(echoResult?.to[0]?.identifier).toBe(PSID)
  })

  it('uses the IGBID as our side for Instagram', () => {
    const igbid = '17841400000000000'
    const igsid = '19876543210'
    const result = convertMetaWebhookEventToMessageData({
      event: {
        sender: { id: igsid },
        recipient: { id: igbid },
        timestamp: 1_755_000_000_000,
        message: { mid: 'm_ig_1', text: 'hi' },
      },
      integrationId: 'int_2',
      organizationId: 'org_1',
      pageId: igbid,
      platform: 'instagram',
      metadata: { instagramUsername: 'auxxlift' },
    })

    expect(result?.externalThreadId).toBe(socialThreadKey(igbid, igsid))
    expect(result?.to[0]?.name).toBe('auxxlift')
  })

  it('drops an event whose page side is not this channel', () => {
    const result = convertMetaWebhookEventToMessageData({
      event: inbound({ recipient: { id: 'some_other_page' } }),
      ...BASE,
    })
    expect(result).toBeNull()
  })

  it('drops unusable events instead of throwing', () => {
    expect(
      convertMetaWebhookEventToMessageData({ event: inbound({ message: {} }), ...BASE })
    ).toBeNull()
    expect(
      convertMetaWebhookEventToMessageData({ event: inbound({ sender: {} }), ...BASE })
    ).toBeNull()
    expect(
      convertMetaWebhookEventToMessageData({
        event: {} as MetaWebhookMessagingEvent,
        ...BASE,
      })
    ).toBeNull()
  })

  it('falls back to the attachment title for the snippet when there is no text', () => {
    const result = convertMetaWebhookEventToMessageData({
      event: inbound({
        message: {
          mid: 'm_att_1',
          attachments: [{ type: 'image', payload: { url: 'https://x/y.jpg', title: 'receipt' } }],
        },
      }),
      ...BASE,
    })

    expect(result?.snippet).toBe('receipt')
    // No inbound attachment ingestor exists, so claiming true would fire
    // attachment workflow rules for bytes that were never fetched.
    expect(result?.hasAttachments).toBe(false)
  })
})

describe('socialThreadKey', () => {
  it('namespaces DM keys so post comments can share the column', () => {
    expect(socialThreadKey('page', 'user')).toBe('dm:page:user')
  })
})
