// packages/lib/src/channels/__tests__/identifier-type-for-provider.test.ts
//
// channel-identity-and-is-internal plan §7 — `identifierTypeForProvider` must be
// the ONLY provider→IdentifierType mapping in the tree. `determineIdentifierType`
// in `ingest/participants/normalize.ts` used to carry its own switch, which made
// it the third hand-maintained per-provider list beside the two capability maps —
// the same drift that kept `openphone` out of the composer's From picker for
// months. The exact-set-equality assertion below is what makes adding a provider
// without a mapping a failing test rather than a silent `EMAIL` default.

import { IdentifierType, IntegrationProviderTypeValues } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { identifierTypeForProvider, PLATFORM_CAPABILITIES } from '../capabilities'

/**
 * Providers with no participant id space of their own. `shopify` is a data-only
 * integration — it never produces a Participant. Adding to this set is a
 * deliberate act; it must not become the dumping ground for "not sure yet".
 */
const PROVIDERS_WITHOUT_PARTICIPANTS = new Set(['shopify'])

describe('identifierTypeForProvider', () => {
  it('covers every IntegrationProviderType — exact set equality, no gaps', () => {
    const mapped = new Set(
      IntegrationProviderTypeValues.filter((p) => identifierTypeForProvider(p) !== undefined)
    )
    const expected = new Set(
      IntegrationProviderTypeValues.filter((p) => !PROVIDERS_WITHOUT_PARTICIPANTS.has(p))
    )
    expect(mapped).toEqual(expected)
  })

  it('returns undefined for providers with no participants, never a default', () => {
    for (const provider of PROVIDERS_WITHOUT_PARTICIPANTS) {
      expect(identifierTypeForProvider(provider)).toBeUndefined()
    }
  })

  it('returns undefined for an unknown or absent provider', () => {
    expect(identifierTypeForProvider('not-a-provider')).toBeUndefined()
    expect(identifierTypeForProvider(null)).toBeUndefined()
    expect(identifierTypeForProvider(undefined)).toBeUndefined()
  })

  it('maps each wired provider to the id space it actually keys on', () => {
    expect(identifierTypeForProvider('google')).toBe(IdentifierType.EMAIL)
    expect(identifierTypeForProvider('outlook')).toBe(IdentifierType.EMAIL)
    expect(identifierTypeForProvider('imap')).toBe(IdentifierType.EMAIL)
    expect(identifierTypeForProvider('mailgun')).toBe(IdentifierType.EMAIL)
    expect(identifierTypeForProvider('email')).toBe(IdentifierType.EMAIL)
    expect(identifierTypeForProvider('openphone')).toBe(IdentifierType.PHONE)
    expect(identifierTypeForProvider('sms')).toBe(IdentifierType.PHONE)
    expect(identifierTypeForProvider('whatsapp')).toBe(IdentifierType.PHONE)
    expect(identifierTypeForProvider('chat')).toBe(IdentifierType.CHAT_VISITOR)
    expect(identifierTypeForProvider('facebook')).toBe(IdentifierType.FACEBOOK_PSID)
    expect(identifierTypeForProvider('instagram')).toBe(IdentifierType.INSTAGRAM_IGSID)
  })

  it('is not derivable from recipientModel — which is why it is its own field', () => {
    // Both `thread_only`, different id spaces. Any attempt to compute this from
    // `recipientModel` collapses these two onto one answer.
    expect(PLATFORM_CAPABILITIES.facebook.recipientModel).toBe('thread_only')
    expect(PLATFORM_CAPABILITIES.instagram.recipientModel).toBe('thread_only')
    expect(identifierTypeForProvider('facebook')).not.toBe(identifierTypeForProvider('instagram'))
  })
})
