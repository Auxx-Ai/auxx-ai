// packages/lib/src/providers/openphone/__tests__/deep-link.test.ts

import { describe, expect, it } from 'vitest'
import { parseConversationIdFromDeepLink } from '../deep-link'

/**
 * The link is copied from a live `message.received` event (`apiVersion: "v4"`, 2026-08-15).
 * Do not "tidy" it — the point of this fixture is that it is what Quo actually sent, not what the
 * docs describe.
 *
 * ONE deviation from the capture: the `at=` message id is redacted. Quo runs on Twilio, so its
 * message ids are `AC` + 32 hex — byte-identical in shape to a Twilio Account SID, which trips
 * GitHub's push protection. Nothing here is a credential; the redaction only keeps this file
 * pushable. Every field the parser reads is verbatim.
 */
const LIVE_DEEP_LINK =
  'https://my.quo.com/inbox/PN0eLoM7TQ/c/CNa71b750b888a4cdd81cd3a1ff0f8c0a9?at=AC_redacted_msg_id'

describe('parseConversationIdFromDeepLink', () => {
  it('extracts the conversation id from a live deep link', () => {
    expect(parseConversationIdFromDeepLink(LIVE_DEEP_LINK)).toBe(
      'CNa71b750b888a4cdd81cd3a1ff0f8c0a9'
    )
  })

  it('handles a link with no query string', () => {
    expect(parseConversationIdFromDeepLink('https://my.quo.com/inbox/PN0eLoM7TQ/c/CNabc123')).toBe(
      'CNabc123'
    )
  })

  it('returns null for a missing link rather than throwing', () => {
    expect(parseConversationIdFromDeepLink(undefined)).toBeNull()
    expect(parseConversationIdFromDeepLink(null)).toBeNull()
    expect(parseConversationIdFromDeepLink('')).toBeNull()
  })

  it('returns null when the link names no conversation', () => {
    // The phone-number segment is NOT a conversation — matching it would hand ingest a key that
    // groups every thread on the channel into one.
    expect(parseConversationIdFromDeepLink('https://my.quo.com/inbox/PN0eLoM7TQ')).toBeNull()
    expect(parseConversationIdFromDeepLink('https://my.quo.com/settings')).toBeNull()
  })

  it('does not match a non-CN id in the conversation slot', () => {
    expect(parseConversationIdFromDeepLink('https://my.quo.com/inbox/PN0/c/ACnotaconvo')).toBeNull()
  })
})
