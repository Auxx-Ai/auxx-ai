// packages/lib/src/signals/email/__tests__/bot-detection.test.ts

import { describe, expect, it } from 'vitest'
import { classifyTrackingHit } from '../bot-detection'

describe('classifyTrackingHit', () => {
  it('flags a known bot/proxy user-agent', () => {
    const result = classifyTrackingHit({ userAgent: 'GoogleImageProxy/1.0' })
    expect(result).toEqual({ isBot: true, botReason: 'ua' })
  })

  it('matches bot user-agent patterns case-insensitively', () => {
    const result = classifyTrackingHit({ userAgent: 'Mozilla/5.0 curl/8.4.0' })
    expect(result).toEqual({ isBot: true, botReason: 'ua' })
  })

  it('flags a hit landing under 10s after send as a prefetch', () => {
    const sentAt = new Date('2026-01-01T00:00:00.000Z')
    const now = new Date('2026-01-01T00:00:05.000Z')
    const result = classifyTrackingHit({ userAgent: 'Mozilla/5.0', sentAt, now })
    expect(result).toEqual({ isBot: true, botReason: 'prefetch' })
  })

  it('does not flag a hit landing 10s or more after send', () => {
    const sentAt = new Date('2026-01-01T00:00:00.000Z')
    const now = new Date('2026-01-01T00:00:10.000Z')
    const result = classifyTrackingHit({ userAgent: 'Mozilla/5.0', sentAt, now })
    expect(result).toEqual({ isBot: false })
  })

  it('passes a clean, real-looking user-agent', () => {
    const result = classifyTrackingHit({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })
    expect(result).toEqual({ isBot: false })
  })

  it('does not flag a missing user-agent on its own', () => {
    expect(classifyTrackingHit({})).toEqual({ isBot: false })
    expect(classifyTrackingHit({ userAgent: null })).toEqual({ isBot: false })
    expect(classifyTrackingHit({ userAgent: '' })).toEqual({ isBot: false })
  })
})
