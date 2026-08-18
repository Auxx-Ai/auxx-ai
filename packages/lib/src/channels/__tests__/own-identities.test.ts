// packages/lib/src/channels/__tests__/own-identities.test.ts

import { IdentifierType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import type { CachedChannel } from '../../cache/providers/channels-provider'
import {
  buildOrgOwnEmailAddressSet,
  buildOrgOwnIdentitySets,
  isOwnChannelIdentity,
} from '../own-identities'

function channel(overrides: Partial<CachedChannel> = {}): CachedChannel {
  return {
    id: 'int_1',
    credentialId: null,
    provider: 'google' as CachedChannel['provider'],
    displayName: 'Test',
    name: null,
    email: null,
    metadata: null,
    settings: {},
    enabled: true,
    updatedAt: new Date(),
    lastSyncedAt: null,
    lastSuccessfulSync: null,
    requiresReauth: false,
    lastAuthError: null,
    lastAuthErrorAt: null,
    inboxId: null,
    chatWidget: null,
    isExample: false,
    ...overrides,
  }
}

describe('buildOrgOwnEmailAddressSet', () => {
  it('returns an empty set for no channels', () => {
    expect(buildOrgOwnEmailAddressSet([])).toEqual(new Set())
  })

  it('includes each channel primary email, lowercased and trimmed', () => {
    const set = buildOrgOwnEmailAddressSet([channel({ email: '  Primary@Example.com  ' })])
    expect(set).toEqual(new Set(['primary@example.com']))
  })

  it('unions Outlook metadata.emailAliases', () => {
    const set = buildOrgOwnEmailAddressSet([
      channel({
        email: 'primary@outlook.example.com',
        metadata: { emailAliases: ['Alias1@outlook.example.com', 'alias2@outlook.example.com'] },
      }),
    ])
    expect(set).toEqual(
      new Set([
        'primary@outlook.example.com',
        'alias1@outlook.example.com',
        'alias2@outlook.example.com',
      ])
    )
  })

  it('unions Gmail metadata.userEmails (verified send-as)', () => {
    const set = buildOrgOwnEmailAddressSet([
      channel({
        email: 'primary@gmail.example.com',
        metadata: { userEmails: ['primary@gmail.example.com', 'sendas@gmail.example.com'] },
      }),
    ])
    expect(set).toEqual(new Set(['primary@gmail.example.com', 'sendas@gmail.example.com']))
  })

  it('covers the SES forwarding address via the plain email field, no special case needed', () => {
    const set = buildOrgOwnEmailAddressSet([
      channel({
        email: 'shopify-demo@mail.auxx.ai',
        metadata: { channelType: 'forwarding-address', systemManaged: true },
      }),
    ])
    expect(set.has('shopify-demo@mail.auxx.ai')).toBe(true)
  })

  it('unions across multiple channels', () => {
    const set = buildOrgOwnEmailAddressSet([
      channel({ id: 'a', email: 'a@mail.auxx.ai' }),
      channel({ id: 'b', email: 'b@mail.auxx.ai', metadata: { emailAliases: ['b-alias@x.com'] } }),
    ])
    expect(set).toEqual(new Set(['a@mail.auxx.ai', 'b@mail.auxx.ai', 'b-alias@x.com']))
  })

  it('ignores malformed metadata without throwing', () => {
    const set = buildOrgOwnEmailAddressSet([
      channel({ email: null, metadata: { emailAliases: 'not-an-array', userEmails: [42, null] } }),
    ])
    expect(set).toEqual(new Set())
  })

  it('ignores a null email and null metadata', () => {
    const set = buildOrgOwnEmailAddressSet([channel({ email: null, metadata: null })])
    expect(set).toEqual(new Set())
  })

  // `excludeInboxIds` exists for message DIRECTION at the SES door: a personal
  // mailbox's address belongs to a human who also writes mail by hand, so mail
  // from one arriving at a shared channel is inbound there, not the org
  // replying to itself. Ingest's `fromOwnAddress` signal passes no exclusions —
  // it wants the full "is the sender one of ours" answer.
  describe('excludeInboxIds', () => {
    it('drops a channel whose inbox is excluded, aliases included', () => {
      const set = buildOrgOwnEmailAddressSet(
        [
          channel({ id: 'shared', email: 'support@company.com', inboxId: 'ibx_shared' }),
          channel({
            id: 'personal',
            email: 'alice@company.com',
            inboxId: 'ibx_personal',
            metadata: { userEmails: ['alice.alias@company.com'] },
          }),
        ],
        { excludeInboxIds: new Set(['ibx_personal']) }
      )
      expect(set).toEqual(new Set(['support@company.com']))
    })

    it('keeps every channel when no exclusions are passed', () => {
      const channels = [
        channel({ id: 'shared', email: 'support@company.com', inboxId: 'ibx_shared' }),
        channel({ id: 'personal', email: 'alice@company.com', inboxId: 'ibx_personal' }),
      ]
      expect(buildOrgOwnEmailAddressSet(channels)).toEqual(
        new Set(['support@company.com', 'alice@company.com'])
      )
      expect(buildOrgOwnEmailAddressSet(channels, {})).toEqual(
        new Set(['support@company.com', 'alice@company.com'])
      )
    })

    it('keeps an unlinked channel (null inboxId) regardless of the exclusion set', () => {
      const set = buildOrgOwnEmailAddressSet(
        [channel({ email: 'orphan@company.com', inboxId: null })],
        { excludeInboxIds: new Set(['ibx_personal']) }
      )
      expect(set).toEqual(new Set(['orphan@company.com']))
    })
  })
})

describe('buildOrgOwnIdentitySets — the phone arm', () => {
  const quo = (phoneNumber: unknown, overrides: Partial<CachedChannel> = {}) =>
    channel({
      provider: 'openphone' as CachedChannel['provider'],
      email: null,
      metadata: { phoneNumberId: 'PN1', phoneNumber },
      ...overrides,
    })

  it('picks a phone channel up off metadata.phoneNumber', () => {
    const sets = buildOrgOwnIdentitySets([quo('+18889155797')])
    expect(sets[IdentifierType.PHONE]).toEqual(new Set(['+18889155797']))
  })

  it('normalizes to E.164 so the stored digit-strip form still matches', () => {
    // `normalizeIdentifier(x, PHONE)` in ingest strips non-digits without
    // adding a country code, so the set must hold the folded form and
    // `isOwnChannelIdentity` must fold the probe too.
    const sets = buildOrgOwnIdentitySets([quo('(888) 915-5797')])
    expect(sets[IdentifierType.PHONE]).toEqual(new Set(['+18889155797']))
    expect(isOwnChannelIdentity(sets, '18889155797', IdentifierType.PHONE)).toBe(true)
    expect(isOwnChannelIdentity(sets, '+1 888 915 5797', IdentifierType.PHONE)).toBe(true)
  })

  it('omits the bucket entirely when no phone channel is connected', () => {
    const sets = buildOrgOwnIdentitySets([channel({ email: 'support@company.com' })])
    expect(sets[IdentifierType.PHONE]).toBeUndefined()
    expect(isOwnChannelIdentity(sets, '+18889155797', IdentifierType.PHONE)).toBe(false)
  })

  it('drops an unparseable number rather than storing a junk key', () => {
    expect(buildOrgOwnIdentitySets([quo('not-a-number')])[IdentifierType.PHONE]).toBeUndefined()
    expect(buildOrgOwnIdentitySets([quo(null)])[IdentifierType.PHONE]).toBeUndefined()
    expect(buildOrgOwnIdentitySets([quo(undefined)])[IdentifierType.PHONE]).toBeUndefined()
  })

  it('never mixes id spaces — an email is not a phone identity and vice versa', () => {
    const sets = buildOrgOwnIdentitySets([
      quo('+18889155797'),
      channel({ id: 'mail', email: 'support@company.com' }),
    ])
    expect(isOwnChannelIdentity(sets, 'support@company.com', IdentifierType.PHONE)).toBe(false)
    expect(isOwnChannelIdentity(sets, '+18889155797', IdentifierType.EMAIL)).toBe(false)
    expect(isOwnChannelIdentity(sets, 'support@company.com', IdentifierType.EMAIL)).toBe(true)
    expect(isOwnChannelIdentity(sets, '+18889155797', IdentifierType.PHONE)).toBe(true)
  })

  it('honours excludeInboxIds on phone channels too', () => {
    const sets = buildOrgOwnIdentitySets([quo('+18889155797', { inboxId: 'ibx_personal' })], {
      excludeInboxIds: new Set(['ibx_personal']),
    })
    expect(sets[IdentifierType.PHONE]).toBeUndefined()
  })

  it('contributes nothing for a chat channel', () => {
    // Chat's org side is an EMAIL participant minted from the agent's user row,
    // so a CHAT_VISITOR identifier always names the customer. Unlike the Meta
    // channels below, that premise still holds.
    const sets = buildOrgOwnIdentitySets([
      channel({ provider: 'chat' as CachedChannel['provider'], email: null, name: 'Widget' }),
    ])
    expect(sets[IdentifierType.CHAT_VISITOR]).toBeUndefined()
  })
})

describe('buildOrgOwnIdentitySets — the Meta arm', () => {
  const PAGE_ID = '869289333164075'
  const IGBID = '17841400000000000'
  const CUSTOMER_PSID = '27893553143563440'

  const facebook = (metadata: unknown, overrides: Partial<CachedChannel> = {}) =>
    channel({
      id: 'fb',
      provider: 'facebook' as CachedChannel['provider'],
      email: null,
      name: 'Auxx-Lift',
      metadata,
      ...overrides,
    })

  const instagram = (metadata: unknown, overrides: Partial<CachedChannel> = {}) =>
    channel({
      id: 'ig',
      provider: 'instagram' as CachedChannel['provider'],
      email: null,
      name: 'auxxlift',
      metadata,
      ...overrides,
    })

  it('puts a Facebook page id in the FACEBOOK_PSID bucket', () => {
    const sets = buildOrgOwnIdentitySets([facebook({ pageId: PAGE_ID, pageName: 'Auxx-Lift' })])
    expect(sets[IdentifierType.FACEBOOK_PSID]).toEqual(new Set([PAGE_ID]))
    expect(isOwnChannelIdentity(sets, PAGE_ID, IdentifierType.FACEBOOK_PSID)).toBe(true)
  })

  it('leaves a customer PSID on that same channel external — the whole point', () => {
    // Both sides of a Messenger thread live in the FACEBOOK_PSID space. Only the
    // page id is ours; a set that matched anything broader would flip every
    // customer to internal and empty the thread list of counterparts.
    const sets = buildOrgOwnIdentitySets([facebook({ pageId: PAGE_ID, pageName: 'Auxx-Lift' })])
    expect(isOwnChannelIdentity(sets, CUSTOMER_PSID, IdentifierType.FACEBOOK_PSID)).toBe(false)
  })

  it('puts an Instagram business account id in the INSTAGRAM_IGSID bucket', () => {
    const sets = buildOrgOwnIdentitySets([
      instagram({
        pageId: PAGE_ID,
        pageName: 'Auxx-Lift',
        instagramBusinessAccountId: IGBID,
        instagramUsername: 'auxxlift',
      }),
    ])
    expect(sets[IdentifierType.INSTAGRAM_IGSID]).toEqual(new Set([IGBID]))
    expect(isOwnChannelIdentity(sets, IGBID, IdentifierType.INSTAGRAM_IGSID)).toBe(true)
    expect(isOwnChannelIdentity(sets, CUSTOMER_PSID, IdentifierType.INSTAGRAM_IGSID)).toBe(false)
  })

  it('reads only the field the channel routes as — an IG channel carries a pageId that is not its identity', () => {
    // `upsertSocialIntegration` writes `pageId` on BOTH providers; on an
    // Instagram channel it names the page the account publishes through, and no
    // IGSID participant is ever keyed on it.
    const sets = buildOrgOwnIdentitySets([
      instagram({ pageId: PAGE_ID, instagramBusinessAccountId: IGBID }),
    ])
    expect(sets[IdentifierType.FACEBOOK_PSID]).toBeUndefined()
    expect(sets[IdentifierType.INSTAGRAM_IGSID]).toEqual(new Set([IGBID]))
  })

  it('never crosses the two Meta id spaces', () => {
    const sets = buildOrgOwnIdentitySets([
      facebook({ pageId: PAGE_ID }),
      instagram({ pageId: PAGE_ID, instagramBusinessAccountId: IGBID }),
    ])
    expect(isOwnChannelIdentity(sets, IGBID, IdentifierType.FACEBOOK_PSID)).toBe(false)
    expect(isOwnChannelIdentity(sets, PAGE_ID, IdentifierType.INSTAGRAM_IGSID)).toBe(false)
    expect(isOwnChannelIdentity(sets, PAGE_ID, IdentifierType.EMAIL)).toBe(false)
  })

  it('omits the buckets when no Meta channel is connected, or its id is missing', () => {
    expect(
      buildOrgOwnIdentitySets([channel({ email: 'support@company.com' })])[
        IdentifierType.FACEBOOK_PSID
      ]
    ).toBeUndefined()
    expect(buildOrgOwnIdentitySets([facebook(null)])[IdentifierType.FACEBOOK_PSID]).toBeUndefined()
    expect(
      buildOrgOwnIdentitySets([facebook({ pageName: 'Auxx-Lift' })])[IdentifierType.FACEBOOK_PSID]
    ).toBeUndefined()
    expect(
      buildOrgOwnIdentitySets([facebook({ pageId: 12345 })])[IdentifierType.FACEBOOK_PSID]
    ).toBeUndefined()
    expect(
      buildOrgOwnIdentitySets([instagram({ pageId: PAGE_ID })])[IdentifierType.INSTAGRAM_IGSID]
    ).toBeUndefined()
  })

  it('honours excludeInboxIds on Meta channels too', () => {
    const sets = buildOrgOwnIdentitySets(
      [facebook({ pageId: PAGE_ID }, { inboxId: 'ibx_personal' })],
      { excludeInboxIds: new Set(['ibx_personal']) }
    )
    expect(sets[IdentifierType.FACEBOOK_PSID]).toBeUndefined()
  })

  it('stays out of the email arm — buildOrgOwnEmailAddressSet returns only emails', () => {
    // `getOrgOwnEmailAddresses` (SES direction, `fromOwnAddress`) reads that set
    // and has no business seeing an account id.
    const emails = buildOrgOwnEmailAddressSet([
      facebook({ pageId: PAGE_ID, pageName: 'Auxx-Lift' }),
      instagram({ pageId: PAGE_ID, instagramBusinessAccountId: IGBID }),
      channel({ id: 'mail', email: 'support@company.com' }),
    ])
    expect(emails).toEqual(new Set(['support@company.com']))
  })
})
