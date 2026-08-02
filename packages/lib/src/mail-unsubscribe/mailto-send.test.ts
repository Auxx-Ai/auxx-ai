// packages/lib/src/mail-unsubscribe/mailto-send.test.ts
// Tier 3's parser. The header-injection refusal is the load-bearing one: a
// `List-Unsubscribe` value is attacker-controlled text, and it becomes an
// outbound recipient.

import { describe, expect, it } from 'vitest'
import { parseUnsubscribeMailto } from './mailto-send'

describe('parseUnsubscribeMailto', () => {
  it('accepts a bare address', () => {
    expect(parseUnsubscribeMailto('unsub@list.example.com')).toEqual({
      to: 'unsub@list.example.com',
      subject: null,
      body: null,
    })
  })

  it('strips the angle brackets a raw header carries', () => {
    expect(parseUnsubscribeMailto('<mailto:unsub@list.example.com>').to).toBe(
      'unsub@list.example.com'
    )
  })

  it('keeps the RFC 2368 subject — it is often the subscription token', () => {
    expect(
      parseUnsubscribeMailto('mailto:unsub@list.example.com?subject=unsubscribe%20abc123')
    ).toEqual({ to: 'unsub@list.example.com', subject: 'unsubscribe abc123', body: null })
  })

  it('keeps the body when one is published', () => {
    expect(parseUnsubscribeMailto('mailto:u@x.example.com?body=remove+me').body).toBe('remove me')
  })

  it('refuses a value carrying line breaks rather than sanitizing it', () => {
    expect(() => parseUnsubscribeMailto('u@x.example.com\r\nBcc: victim@example.com')).toThrow(
      /line breaks/
    )
  })

  it('refuses an empty value and a value with no address', () => {
    expect(() => parseUnsubscribeMailto('   ')).toThrow(/empty/)
    expect(() => parseUnsubscribeMailto('mailto:notanaddress')).toThrow(/no recipient address/)
  })
})
