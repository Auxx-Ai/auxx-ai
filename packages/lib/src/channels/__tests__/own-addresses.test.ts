// packages/lib/src/channels/__tests__/own-addresses.test.ts

import { describe, expect, it } from 'vitest'
import type { CachedChannel } from '../../cache/providers/channels-provider'
import { buildOrgOwnEmailAddressSet } from '../own-addresses'

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
