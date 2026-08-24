// packages/lib/src/data-migrations/migrations/103-backfill-email-storage-location-org.test.ts

/**
 * The key parse is the entire safety boundary of migration 103: the statement
 * only writes rows this function claims, and only when the claimed segment is a
 * real `Organization`. So the cases that matter are the ones it must REFUSE.
 */

import { describe, expect, it } from 'vitest'
import { organizationIdFromInboundEmailKey } from './103-backfill-email-storage-location-org'

describe('organizationIdFromInboundEmailKey', () => {
  it('recovers the org from a real inbound-email key', () => {
    expect(
      organizationIdFromInboundEmailKey('email/inbound/xg51lh571wu291ke5lh0dqme/1946683f/body.html')
    ).toBe('xg51lh571wu291ke5lh0dqme')
  })

  it('recovers it regardless of how deep the tail goes', () => {
    expect(
      organizationIdFromInboundEmailKey('email/inbound/org_1/msg/attachments/nested/file.pdf')
    ).toBe('org_1')
  })

  it.each([
    ['a normal org-prefixed upload key', 'abgwpa1l81reht2zmwrcihfu/uploads/file.pdf'],
    ['the public workflow share door', 'public-workflow/org_1/share_tok/file.pdf'],
    ['an outbound email key', 'email/outbound/org_1/msg/body.html'],
    ['thumbnails', 'thumbs/org_1/version/sm.webp'],
    ['a documents key', 'documents/org_1/doc.pdf'],
  ])('refuses %s', (_label, key) => {
    expect(organizationIdFromInboundEmailKey(key)).toBeNull()
  })

  it('refuses a truncated inbound key with no trailing segment', () => {
    // `email/inbound/org_1` has no `/` after the org, so there is no message
    // segment -- it is not the shape this migration is claiming.
    expect(organizationIdFromInboundEmailKey('email/inbound/org_1')).toBeNull()
  })

  it('refuses an inbound key with an empty org segment', () => {
    expect(organizationIdFromInboundEmailKey('email/inbound//msg/body.html')).toBeNull()
  })

  it('refuses a key that merely contains the prefix rather than starting with it', () => {
    expect(organizationIdFromInboundEmailKey('org_1/email/inbound/org_2/msg/body.html')).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ])('refuses a %s key', (_label, key) => {
    expect(organizationIdFromInboundEmailKey(key)).toBeNull()
  })
})
