// packages/lib/src/providers/social/__tests__/conversation-message.test.ts
//
// The REST conversation-messages edge is the one Meta shape nobody has captured, so
// this suite pins the two things that survive either answer: the text normalisation
// (scalar `message` vs object `message`) and the thread key, which must be
// byte-identical to what the webhook writes or the conversation forks with no header
// chain to recover it.

import { describe, expect, it } from 'vitest'
import {
  conversationMessageExternalId,
  conversationMessageText,
  convertGraphConversationMessageToMessageData,
  pickConversationCounterpart,
  type TolerantConversationMessage,
} from '../conversation-message'
import { socialThreadKey } from '../thread-key'

const PAGE_ID = '869289333164075'
const PSID = '27893553143563440'
const IGBID = '17841400000000000'
const IGSID = '17842000000000000'

const BASE = {
  integrationId: 'int_1',
  organizationId: 'org_1',
  ourId: PAGE_ID,
  counterpartId: PSID,
  ourName: 'Auxx-Lift',
  platform: 'facebook' as const,
  conversationId: 't_1234567890',
}

function node(overrides: Partial<TolerantConversationMessage> = {}): TolerantConversationMessage {
  return {
    id: 'm_node_1',
    created_time: '2026-08-18T09:41:00+0000',
    from: { id: PSID, name: 'Jane Customer' },
    to: { data: [{ id: PAGE_ID, name: 'Auxx-Lift' }] },
    message: 'where is my order?',
    ...overrides,
  }
}

describe('conversationMessageText', () => {
  it('reads a scalar `message` — the shape Graph documents', () => {
    expect(conversationMessageText('where is my order?')).toBe('where is my order?')
  })

  it('reads an object `message` via its `text` — the shape we cannot rule out', () => {
    expect(conversationMessageText({ text: 'where is my order?', mid: 'm_1' })).toBe(
      'where is my order?'
    )
  })

  it('is undefined for a shape it does not understand, never a coerced string', () => {
    expect(conversationMessageText(undefined)).toBeUndefined()
    expect(conversationMessageText({})).toBeUndefined()
    // The bug this whole module exists to prevent: `String(message)` on an object
    // stores "[object Object]" as the body of a real customer message.
    expect(conversationMessageText({ mid: 'm_1' })).toBeUndefined()
  })
})

describe('conversationMessageExternalId', () => {
  it('prefers an inner `mid` — the id the webhook and the send path both stamp', () => {
    expect(conversationMessageExternalId(node({ id: 'm_node', message: { mid: 'm_wire' } }))).toBe(
      'm_wire'
    )
  })

  it("falls back to the node's own id when the scalar shape carries no mid", () => {
    expect(conversationMessageExternalId(node())).toBe('m_node_1')
  })

  it('is undefined when the node has neither', () => {
    expect(
      conversationMessageExternalId({ created_time: '2026-08-18T09:41:00+0000' })
    ).toBeUndefined()
  })
})

describe('pickConversationCounterpart', () => {
  it('picks the non-page participant', () => {
    const counterpart = pickConversationCounterpart(
      {
        participants: {
          data: [
            { id: PAGE_ID, name: 'Auxx-Lift' },
            { id: PSID, name: 'Jane' },
          ],
        },
      },
      PAGE_ID
    )
    expect(counterpart).toEqual({ id: PSID, name: 'Jane' })
  })

  it('prefers the IG username as the display name', () => {
    const counterpart = pickConversationCounterpart(
      { participants: { data: [{ id: IGBID }, { id: IGSID, username: 'jane.doe' }] } },
      IGBID
    )
    expect(counterpart?.name).toBe('jane.doe')
  })

  it('excludes EVERY id that is us — the IG account and the linked page', () => {
    // Which of the two Graph lists for `platform=instagram` is unverified, so the
    // pick must not depend on guessing right.
    const counterpart = pickConversationCounterpart(
      { participants: { data: [{ id: PAGE_ID }, { id: IGSID, username: 'jane.doe' }] } },
      [IGBID, PAGE_ID]
    )
    expect(counterpart?.id).toBe(IGSID)
  })

  it('returns null when only our own side is present', () => {
    expect(
      pickConversationCounterpart({ participants: { data: [{ id: PAGE_ID }] } }, PAGE_ID)
    ).toBe(null)
    expect(pickConversationCounterpart({}, PAGE_ID)).toBe(null)
  })
})

describe('convertGraphConversationMessageToMessageData', () => {
  it('stores the text and the node id from the SCALAR message shape', () => {
    const result = convertGraphConversationMessageToMessageData({ message: node(), ...BASE })

    expect(result?.textPlain).toBe('where is my order?')
    expect(result?.snippet).toBe('where is my order?')
    expect(result?.externalId).toBe('m_node_1')
    expect(result?.isInbound).toBe(true)
  })

  it('stores the text and the mid from the OBJECT message shape', () => {
    const result = convertGraphConversationMessageToMessageData({
      message: node({ message: { text: 'where is my order?', mid: 'm_wire_1' } }),
      ...BASE,
    })

    expect(result?.textPlain).toBe('where is my order?')
    expect(result?.externalId).toBe('m_wire_1')
  })

  it('agrees with socialThreadKey — the same key the webhook writes', () => {
    const result = convertGraphConversationMessageToMessageData({ message: node(), ...BASE })

    expect(result?.externalThreadId).toBe(socialThreadKey(PAGE_ID, PSID))
    // Never the `t_…` conversation id: the webhook never sees one, so keying on it
    // splits every conversation that arrives through both doors.
    expect(result?.externalThreadId).not.toBe(BASE.conversationId)
    expect(result?.metadata?.meta_conversation_id).toBe(BASE.conversationId)
  })

  it('keys an Instagram DM on the IG business account id, not the page id', () => {
    const result = convertGraphConversationMessageToMessageData({
      message: node({ from: { id: IGSID, username: 'jane.doe' } }),
      ...BASE,
      platform: 'instagram',
      ourId: IGBID,
      counterpartId: IGSID,
      ourName: 'auxxlift',
    })

    expect(result?.externalThreadId).toBe(socialThreadKey(IGBID, IGSID))
    expect(result?.from.identifier).toBe(IGSID)
    expect(result?.from.name).toBe('jane.doe')
    expect(result?.to[0]?.identifier).toBe(IGBID)
  })

  it('reads a page-sent Instagram node as OURS when Graph names the linked Page, not the IGBID', () => {
    // The two-id problem. On `platform=instagram` the edge is addressed on the
    // linked Page while our identity in the key is the IGBID, and which one Graph
    // puts in `from` on a business-sent node is unverified. Without the alias the
    // node matches neither `ourId` nor the counterpart and is dropped as "a third
    // party" — an IG backfill that keeps the customer's messages and none of ours.
    const result = convertGraphConversationMessageToMessageData({
      message: node({ id: 'm_ig_out', from: { id: PAGE_ID, username: 'auxxlift' } }),
      ...BASE,
      platform: 'instagram',
      ourId: IGBID,
      ourAliasIds: [PAGE_ID],
      counterpartId: IGSID,
      counterpartName: 'jane.doe',
      ourName: 'auxxlift',
    })

    expect(result).not.toBe(null)
    expect(result?.isInbound).toBe(false)
    // The alias decides DIRECTION only. The identifier and the key stay on the
    // IGBID, or this message forks off the thread the webhook already wrote.
    expect(result?.from.identifier).toBe(IGBID)
    expect(result?.externalThreadId).toBe(socialThreadKey(IGBID, IGSID))
    expect(result?.to[0]?.identifier).toBe(IGSID)
    expect(result?.to[0]?.name).toBe('jane.doe')
  })

  it('still drops a genuine third party when aliases are configured', () => {
    expect(
      convertGraphConversationMessageToMessageData({
        message: node({ from: { id: '999999999' } }),
        ...BASE,
        platform: 'instagram',
        ourId: IGBID,
        ourAliasIds: [PAGE_ID],
        counterpartId: IGSID,
      })
    ).toBe(null)
  })

  it('marks a page-sent message outbound and gives it the SAME thread key', () => {
    const inbound = convertGraphConversationMessageToMessageData({ message: node(), ...BASE })
    const outbound = convertGraphConversationMessageToMessageData({
      message: node({ id: 'm_node_2', from: { id: PAGE_ID, name: 'Auxx-Lift' } }),
      ...BASE,
    })

    expect(outbound?.isInbound).toBe(false)
    expect(outbound?.from.identifier).toBe(PAGE_ID)
    expect(outbound?.to[0]?.identifier).toBe(PSID)
    expect(outbound?.externalThreadId).toBe(inbound?.externalThreadId)
  })

  it('never names the counterpart after the sender of a page-sent message', () => {
    // Regression: `from` was stamped on BOTH participants, so every page-sent node
    // wrote our Page's name onto the customer — and the participant upsert takes the
    // last write carrying a usable name, so a single reply of ours renamed the
    // customer for good and their whole history rendered as authored by the Page.
    const outbound = convertGraphConversationMessageToMessageData({
      message: node({ id: 'm_node_3', from: { id: PAGE_ID, name: 'Auxx-Lift' } }),
      ...BASE,
      counterpartName: 'Jane Customer',
    })

    expect(outbound?.from.name).toBe('Auxx-Lift')
    expect(outbound?.to[0]?.name).toBe('Jane Customer')
  })

  it('falls back to the conversation participant name, not the page name, when a page-sent node is all we have', () => {
    const outbound = convertGraphConversationMessageToMessageData({
      message: node({ id: 'm_node_4', from: { id: PAGE_ID, name: 'Auxx-Lift' } }),
      ...BASE,
      counterpartName: undefined,
    })

    expect(outbound?.to[0]?.name).toBeUndefined()
  })

  it('carries no subject — these are DMs, not the "commented on your post" fiction', () => {
    const result = convertGraphConversationMessageToMessageData({ message: node(), ...BASE })
    expect(result?.subject).toBeUndefined()
  })

  it('claims no attachments for a descriptor with no URL to download', () => {
    const result = convertGraphConversationMessageToMessageData({
      message: node({
        message: { attachments: [{ type: 'image', payload: { title: 'receipt.png' } }] },
      }),
      ...BASE,
    })

    expect(result?.hasAttachments).toBe(false)
    // The attachment still names the message, so an image-only DM is not a blank row.
    expect(result?.snippet).toBe('receipt.png')
  })

  it("claims attachments from the node's own `attachments` connection", () => {
    const result = convertGraphConversationMessageToMessageData({
      message: node({
        message: undefined,
        attachments: {
          data: [
            {
              id: 'a1',
              name: 'receipt.png',
              mime_type: 'image/png',
              size: 1024,
              image_data: { url: 'https://lookaside.fbsbx.com/a1' },
            },
          ],
        },
      }),
      ...BASE,
    })

    expect(result?.hasAttachments).toBe(true)
    expect(result?.snippet).toBe('receipt.png')
  })

  it('claims attachments from the tolerated object body when the connection is absent', () => {
    const result = convertGraphConversationMessageToMessageData({
      message: node({
        message: {
          attachments: [{ type: 'image', payload: { url: 'https://lookaside.fbsbx.com/b1' } }],
        },
      }),
      ...BASE,
    })

    expect(result?.hasAttachments).toBe(true)
  })

  it('drops a node with no id, no sender, an unparseable time, or a third-party sender', () => {
    expect(
      convertGraphConversationMessageToMessageData({
        message: node({ id: undefined, message: 'hi' }),
        ...BASE,
      })
    ).toBe(null)
    expect(
      convertGraphConversationMessageToMessageData({ message: node({ from: undefined }), ...BASE })
    ).toBe(null)
    expect(
      convertGraphConversationMessageToMessageData({
        message: node({ created_time: 'not a date' }),
        ...BASE,
      })
    ).toBe(null)
    expect(
      convertGraphConversationMessageToMessageData({
        message: node({ from: { id: '999999999' } }),
        ...BASE,
      })
    ).toBe(null)
  })
})
