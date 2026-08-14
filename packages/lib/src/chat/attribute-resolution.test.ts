// packages/lib/src/chat/attribute-resolution.test.ts

import { describe, expect, it } from 'vitest'
import { resolveChatAttributes } from './attribute-resolution'

describe('resolveChatAttributes — reserved identity claims', () => {
  it('strips contact identity fields from boot attributes', () => {
    const { writes } = resolveChatAttributes({
      bootAttributes: {
        primary_email: 'attacker@evil.com',
        phone: '+1555000000',
        company_website: 'https://evil.com',
        email: 'attacker@evil.com',
        plan: 'pro',
      },
    })

    expect(writes).not.toHaveProperty('primary_email')
    expect(writes).not.toHaveProperty('phone')
    expect(writes).not.toHaveProperty('company_website')
    expect(writes).not.toHaveProperty('email')
    expect(writes).toEqual({ plan: 'pro' })
  })

  it('strips identity fields from every tier, not just boot', () => {
    const { writes } = resolveChatAttributes({
      jwtClaims: { primary_email: 'x@y.com', phone: '+1', role: 'admin' },
      serverAttributes: { company_website: 'https://z.com', city: 'Berlin' },
      bootAttributes: { primary_email: 'a@b.com' },
    })

    expect(writes).not.toHaveProperty('primary_email')
    expect(writes).not.toHaveProperty('phone')
    expect(writes).not.toHaveProperty('company_website')
    expect(writes).toEqual({ role: 'admin', city: 'Berlin' })
  })

  it('strips JWT framing and user_id claims', () => {
    const { writes } = resolveChatAttributes({
      jwtClaims: { user_id: 'u1', exp: 1, iat: 1, nbf: 1, iss: 'i', aud: 'a', sub: 's' },
    })

    expect(writes).toEqual({})
  })

  it('keeps jwt > server > boot precedence for non-reserved keys', () => {
    const { writes } = resolveChatAttributes({
      jwtClaims: { plan: 'enterprise' },
      serverAttributes: { plan: 'growth', city: 'Berlin' },
      bootAttributes: { plan: 'free', locale: 'de' },
    })

    expect(writes).toEqual({ plan: 'enterprise', city: 'Berlin', locale: 'de' })
  })
})
