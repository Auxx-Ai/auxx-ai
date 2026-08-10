// packages/lib/src/mail-unsubscribe/client.test.ts
// The safety gate and the three tiers — the two rules that decide whether we
// touch a stranger's endpoint at all.
//
// Pure module, no mocks: the shared `src/test/setup.ts` proxy stays in place
// (never fully replace a shared `vi.mock` in lib tests — the graph dies at
// COLLECTION when it grows).

import { describe, expect, it } from 'vitest'
import {
  parseMailSubjectKey,
  parseUnsubscribeMeta,
  selectUnsubscribeMethod,
  toMailSubjectKey,
  unsubscribeRefusal,
} from './client'

const oneClickMeta = { httpUrl: 'https://list.example.com/u/abc', oneClick: true }
const httpOnlyMeta = { httpUrl: 'https://list.example.com/u/abc', oneClick: false }
const mailtoOnlyMeta = { mailto: 'unsub-abc@list.example.com', oneClick: false }

describe('selectUnsubscribeMethod — the safety gate (§6.2, invariants 3 & 4)', () => {
  it('refuses when there is no listId and senderAuthenticated is NULL', () => {
    const offer = selectUnsubscribeMethod({
      listId: null,
      senderAuthenticated: null,
      unsubscribeMeta: oneClickMeta,
    })

    expect(offer.offered).toBe(false)
    if (offer.offered) throw new Error('unreachable')
    expect(offer.reason).toBe('unverified-sender')
    expect(offer.alternative).toBe('block-sender')
  })

  it('refuses when there is no listId and senderAuthenticated is FALSE', () => {
    const offer = selectUnsubscribeMethod({
      listId: null,
      senderAuthenticated: false,
      unsubscribeMeta: oneClickMeta,
    })

    expect(offer.offered).toBe(false)
    if (offer.offered) throw new Error('unreachable')
    expect(offer.reason).toBe('unverified-sender')
  })

  it('allows when there is no listId but senderAuthenticated is TRUE', () => {
    const offer = selectUnsubscribeMethod({
      listId: null,
      senderAuthenticated: true,
      unsubscribeMeta: oneClickMeta,
    })

    expect(offer).toEqual({ offered: true, method: 'one-click', httpUrl: oneClickMeta.httpUrl })
  })

  it('allows on a real listId even when the sender is unauthenticated — a list-id IS the identity', () => {
    for (const senderAuthenticated of [null, false] as const) {
      const offer = selectUnsubscribeMethod({
        listId: 'stripe.updates.example.com',
        senderAuthenticated,
        unsubscribeMeta: httpOnlyMeta,
      })
      expect(offer.offered).toBe(true)
    }
  })

  it('refuses when there is no unsubscribe header at all', () => {
    const offer = selectUnsubscribeMethod({
      listId: 'stripe.updates.example.com',
      senderAuthenticated: true,
      unsubscribeMeta: null,
    })

    expect(offer.offered).toBe(false)
    if (offer.offered) throw new Error('unreachable')
    expect(offer.reason).toBe('no-unsubscribe-method')
    expect(offer.alternative).toBe('block-sender')
  })
})

describe('unsubscribeRefusal — the ONE predicate the card also renders (v2 §4.1)', () => {
  const meta = { listId: null, senderAuthenticated: null, hasUnsubscribeMethod: true }

  it('treats senderAuthenticated NULL exactly like FALSE on a domain group (invariant 3)', () => {
    for (const senderAuthenticated of [null, false] as const) {
      expect(unsubscribeRefusal({ ...meta, senderAuthenticated })).toMatchObject({
        offered: false,
        reason: 'unverified-sender',
        alternative: 'block-sender',
      })
    }
  })

  it('passes on a domain group only when the sender is explicitly authenticated', () => {
    expect(unsubscribeRefusal({ ...meta, senderAuthenticated: true })).toBeNull()
  })

  it('passes on a list-id regardless of the verdict — the list IS the identity', () => {
    for (const senderAuthenticated of [null, false, true] as const) {
      expect(
        unsubscribeRefusal({ ...meta, listId: 'l.example.com', senderAuthenticated })
      ).toBeNull()
    }
  })

  it('refuses a verified sender that publishes no address', () => {
    expect(
      unsubscribeRefusal({
        listId: 'l.example.com',
        senderAuthenticated: true,
        hasUnsubscribeMethod: false,
      })
    ).toMatchObject({ offered: false, reason: 'no-unsubscribe-method' })
  })

  it('ranks the unverified branch first — the identity question precedes the header one', () => {
    expect(
      unsubscribeRefusal({
        listId: null,
        senderAuthenticated: null,
        hasUnsubscribeMethod: false,
      })
    ).toMatchObject({ reason: 'unverified-sender' })
  })

  it('is the same authority selectUnsubscribeMethod uses — identical message, every case', () => {
    const rows = [
      { listId: null, senderAuthenticated: null },
      { listId: null, senderAuthenticated: false },
      { listId: null, senderAuthenticated: true },
      { listId: 'l.example.com', senderAuthenticated: null },
      { listId: 'l.example.com', senderAuthenticated: true },
    ] as const

    for (const row of rows) {
      for (const unsubscribeMeta of [oneClickMeta, httpOnlyMeta, mailtoOnlyMeta, null]) {
        const offer = selectUnsubscribeMethod({ ...row, unsubscribeMeta })
        const refusal = unsubscribeRefusal({
          ...row,
          hasUnsubscribeMethod: unsubscribeMeta !== null,
        })

        expect(offer.offered).toBe(refusal === null)
        if (!offer.offered) expect(offer.message).toBe(refusal?.message)
      }
    }
  })
})

describe('selectUnsubscribeMethod — tiers are chosen BY HEADER, never by provider (§6.1)', () => {
  const base = { listId: 'l.example.com', senderAuthenticated: true } as const

  it('one-click requires BOTH the RFC 8058 flag and an http url', () => {
    expect(selectUnsubscribeMethod({ ...base, unsubscribeMeta: oneClickMeta })).toEqual({
      offered: true,
      method: 'one-click',
      httpUrl: oneClickMeta.httpUrl,
    })
  })

  it('an http url WITHOUT the one-click header is tier 2 — we hand it to the client, never POST it', () => {
    expect(selectUnsubscribeMethod({ ...base, unsubscribeMeta: httpOnlyMeta })).toEqual({
      offered: true,
      method: 'http',
      httpUrl: httpOnlyMeta.httpUrl,
    })
  })

  it('the one-click flag alone (no url) never unlocks the POST tier', () => {
    const offer = selectUnsubscribeMethod({
      ...base,
      unsubscribeMeta: { mailto: 'u@list.example.com', oneClick: true },
    })
    expect(offer).toEqual({ offered: true, method: 'mailto', mailto: 'u@list.example.com' })
  })

  it('mailto only is tier 3', () => {
    expect(selectUnsubscribeMethod({ ...base, unsubscribeMeta: mailtoOnlyMeta })).toEqual({
      offered: true,
      method: 'mailto',
      mailto: mailtoOnlyMeta.mailto,
    })
  })

  it('prefers the http url when a sender publishes both', () => {
    const offer = selectUnsubscribeMethod({
      ...base,
      unsubscribeMeta: {
        httpUrl: 'https://x.example.com/u',
        mailto: 'u@x.example.com',
        oneClick: false,
      },
    })
    expect(offer).toEqual({ offered: true, method: 'http', httpUrl: 'https://x.example.com/u' })
  })
})

describe('parseUnsubscribeMeta', () => {
  it('returns null for anything without a usable target', () => {
    expect(parseUnsubscribeMeta(null)).toBeNull()
    expect(parseUnsubscribeMeta('https://x.example.com')).toBeNull()
    expect(parseUnsubscribeMeta([])).toBeNull()
    expect(parseUnsubscribeMeta({ oneClick: true })).toBeNull()
  })

  it('coerces oneClick with === true, so a truthy backfill value cannot unlock the POST tier', () => {
    const parsed = parseUnsubscribeMeta({ httpUrl: 'https://x.example.com/u', oneClick: '1' })
    expect(parsed).toEqual({
      httpUrl: 'https://x.example.com/u',
      mailto: undefined,
      oneClick: false,
    })
  })
})

describe('subject keys stay two prefixes (S7, invariant 8)', () => {
  it('prefers listId over senderDomain', () => {
    expect(toMailSubjectKey({ listId: 'l.example.com', senderDomain: 'example.com' })).toBe(
      'list:l.example.com'
    )
  })

  it('falls back to the domain', () => {
    expect(toMailSubjectKey({ listId: null, senderDomain: 'example.com' })).toBe(
      'domain:example.com'
    )
  })

  it('round-trips', () => {
    expect(parseMailSubjectKey('list:l.example.com')).toEqual({
      kind: 'list',
      listId: 'l.example.com',
    })
    expect(parseMailSubjectKey('domain:example.com')).toEqual({
      kind: 'domain',
      senderDomain: 'example.com',
    })
  })

  it('rejects an unknown prefix and an empty payload', () => {
    expect(parseMailSubjectKey('sender:example.com')).toBeNull()
    expect(parseMailSubjectKey('list:')).toBeNull()
  })
})
