// packages/lib/src/providers/social/__tests__/send.test.ts

import { describe, expect, it } from 'vitest'
import { MESSAGING_WINDOW_MS, resolveSendPolicy } from '../send'

/**
 * FB/IG plan WS4 — Meta's 24-hour messaging window.
 *
 * The rule that carries real risk is the third one: an automated send outside the
 * window must be BLOCKED, not tagged. `HUMAN_AGENT` asserts a human is typing;
 * applying it to agent or workflow traffic is a policy violation Meta detects,
 * and the penalty lands on the customer's page.
 */
const NOW = new Date('2026-08-17T22:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('resolveSendPolicy', () => {
  it('sends a plain RESPONSE inside the window', () => {
    const policy = resolveSendPolicy({
      lastInboundAt: ago(2 * 60 * 60 * 1000),
      automated: false,
      now: NOW,
    })

    expect(policy.messagingType).toBe('RESPONSE')
    expect(policy.tag).toBeUndefined()
    expect(policy.withinWindow).toBe(true)
  })

  it('sends RESPONSE for an automated reply inside the window', () => {
    const policy = resolveSendPolicy({
      lastInboundAt: ago(60 * 1000),
      automated: true,
      now: NOW,
    })

    expect(policy.messagingType).toBe('RESPONSE')
    expect(policy.withinWindow).toBe(true)
  })

  it('tags a HUMAN send outside the window', () => {
    const policy = resolveSendPolicy({
      lastInboundAt: ago(MESSAGING_WINDOW_MS + 1000),
      automated: false,
      now: NOW,
    })

    expect(policy.messagingType).toBe('MESSAGE_TAG')
    expect(policy.tag).toBe('HUMAN_AGENT')
    expect(policy.withinWindow).toBe(false)
  })

  it('BLOCKS an automated send outside the window rather than tagging it', () => {
    expect(() =>
      resolveSendPolicy({
        lastInboundAt: ago(MESSAGING_WINDOW_MS + 1000),
        automated: true,
        now: NOW,
      })
    ).toThrow(/24-hour messaging window/)
  })

  it('blocks automated first contact, where there is no inbound at all', () => {
    expect(() => resolveSendPolicy({ lastInboundAt: null, automated: true, now: NOW })).toThrow(
      /messaged first/
    )
  })

  it('treats the boundary itself as outside the window', () => {
    // Exactly 24h is already too late — Meta measures from the user's message,
    // and a send racing the boundary should fail closed, not closed-ish.
    const policy = resolveSendPolicy({
      lastInboundAt: ago(MESSAGING_WINDOW_MS),
      automated: false,
      now: NOW,
    })

    expect(policy.withinWindow).toBe(false)
    expect(policy.messagingType).toBe('MESSAGE_TAG')
  })
})
