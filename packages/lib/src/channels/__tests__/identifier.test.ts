// packages/lib/src/channels/__tests__/identifier.test.ts

import { describe, expect, it } from 'vitest'
import { getChannelLabel, getIdentifier } from '../internal/identifier'

const fbPage = {
  provider: 'facebook',
  email: null,
  name: null,
  metadata: { pageId: '869289333164075', pageName: 'Auxx-Lift' },
}

const igAccount = {
  provider: 'instagram',
  email: null,
  name: null,
  metadata: {
    pageId: '869289333164075',
    pageName: 'Auxx-Lift',
    instagramBusinessAccountId: '17841400000000000',
    instagramUsername: 'auxxlift',
  },
}

/**
 * The address a channel sends *as*. This feeds
 * `findOrCreateParticipantForIntegration`, so anything it returns becomes the
 * FROM `Participant.identifier` of every outbound message on that channel.
 *
 * Regression under test: the Page name used to be returned here, which minted a
 * participant with `identifier: 'Auxx-Lift'` typed FACEBOOK_PSID — unroutable,
 * and never corrected because the reconciler does not rewrite participants.
 */
describe('getIdentifier — routing identity', () => {
  it('routes a Facebook channel by Page id, never the Page name', () => {
    expect(getIdentifier(fbPage)).toBe('869289333164075')
  })

  it('routes an Instagram channel by IG business account id, not the handle', () => {
    expect(getIdentifier(igAccount)).toBe('17841400000000000')
  })

  it('returns undefined rather than a display name when nothing routable exists', () => {
    // Declared as rows rather than inline literals on purpose: `getIdentifier`'s
    // parameter type no longer has a `name` field at all, so the compiler already
    // refuses the inline form. These assert the runtime half of that guarantee.
    const namedPage = { provider: 'facebook', email: null, name: 'Fallback', metadata: {} }
    const namedLine = { provider: 'openphone', email: null, name: 'Support Line', metadata: {} }
    expect(getIdentifier(namedPage)).toBeUndefined()
    expect(getIdentifier(namedLine)).toBeUndefined()
  })

  it('still prefers an explicit email over social metadata', () => {
    const mailbox = {
      provider: 'google',
      email: 'support@auxx.ai',
      name: null,
      metadata: { pageName: 'ignored' },
    }
    expect(getIdentifier(mailbox)).toBe('support@auxx.ai')
  })

  it('reads a phone channel number from metadata', () => {
    const phoneChannel = {
      provider: 'openphone',
      email: null,
      name: 'Support Line',
      metadata: { phoneNumber: '+15551234567' },
    }
    expect(getIdentifier(phoneChannel)).toBe('+15551234567')
  })

  it('returns undefined for a null channel', () => {
    expect(getIdentifier(null)).toBeUndefined()
  })
})

/**
 * The channel label every settings/list surface renders. Meta social channels had
 * no case here at all, so a connected Facebook Page showed as a bare "Facebook
 * Integration" with the page name nowhere on the screen — the name was computed at
 * connect time, emitted on the `integration:connected` event, and then dropped.
 */
describe('getChannelLabel — display only', () => {
  it('labels a Facebook channel with its page name', () => {
    expect(getChannelLabel(fbPage)).toBe('Auxx-Lift')
  })

  it('prefers the Instagram handle over the page name', () => {
    // The IG channel is the account customers actually see; the linked Page name
    // is frequently different and would read as the wrong account.
    expect(getChannelLabel(igAccount)).toBe('auxxlift')
  })

  it('reads from metadata, so channels connected before the name was persisted still resolve', () => {
    expect(
      getChannelLabel({
        provider: 'facebook',
        email: null,
        name: null,
        metadata: { pageName: 'Auxx-Lift' },
      })
    ).toBe('Auxx-Lift')
  })

  it('prefers a persisted Integration.name over metadata', () => {
    expect(getChannelLabel({ ...fbPage, name: 'Renamed Channel' })).toBe('Renamed Channel')
  })

  it('falls back to undefined when there is nothing human-readable', () => {
    expect(
      getChannelLabel({ provider: 'facebook', email: null, name: null, metadata: {} })
    ).toBeUndefined()
  })
})
