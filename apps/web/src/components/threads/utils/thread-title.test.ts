// apps/web/src/components/threads/utils/thread-title.test.ts

import { describe, expect, it } from 'vitest'
import {
  channelCarriesSubject,
  formatParticipantIdentifier,
  pickThreadCounterparty,
  resolveThreadTitle,
  type ThreadTitleCandidate,
  type ThreadTitleParticipant,
} from './thread-title'

const phoneParticipant = (
  overrides: Partial<ThreadTitleParticipant> = {}
): ThreadTitleParticipant => ({
  name: null,
  identifier: '+15102055536',
  identifierType: 'PHONE',
  displayName: '+15102055536',
  ...overrides,
})

const emailParticipant = (
  overrides: Partial<ThreadTitleParticipant> = {}
): ThreadTitleParticipant => ({
  name: null,
  identifier: 'ada@example.com',
  identifierType: 'EMAIL',
  displayName: 'ada@example.com',
  ...overrides,
})

describe('channelCarriesSubject', () => {
  it('is true for email providers', () => {
    expect(channelCarriesSubject('google')).toBe(true)
    expect(channelCarriesSubject('outlook')).toBe(true)
    expect(channelCarriesSubject('mailgun')).toBe(true)
  })

  it('is false for messaging providers', () => {
    expect(channelCarriesSubject('sms')).toBe(false)
    expect(channelCarriesSubject('openphone')).toBe(false)
    expect(channelCarriesSubject('whatsapp')).toBe(false)
    expect(channelCarriesSubject('facebook')).toBe(false)
  })

  it('fails safe to subject-carrying for unknown or missing providers', () => {
    expect(channelCarriesSubject(null)).toBe(true)
    expect(channelCarriesSubject(undefined)).toBe(true)
    expect(channelCarriesSubject('carrier-pigeon')).toBe(true)
  })
})

describe('formatParticipantIdentifier', () => {
  it('formats an E.164 phone identifier for display', () => {
    expect(formatParticipantIdentifier(phoneParticipant())).toBe('+1 510 205 5536')
  })

  it('formats non-US numbers with their own country code', () => {
    expect(formatParticipantIdentifier(phoneParticipant({ identifier: '+4930901820' }))).toBe(
      '+49 30 901820'
    )
  })

  it('falls back to the raw identifier when it does not parse', () => {
    expect(formatParticipantIdentifier(phoneParticipant({ identifier: 'not-a-number' }))).toBe(
      'not-a-number'
    )
  })

  it('returns email identifiers untouched', () => {
    expect(formatParticipantIdentifier(emailParticipant())).toBe('ada@example.com')
  })

  it('returns null for chat visitors — their identifier is an opaque session id', () => {
    expect(
      formatParticipantIdentifier({
        name: null,
        identifier: '0f2b8a1e-1111-2222-3333-444455556666',
        identifierType: 'CHAT_VISITOR',
        displayName: 'Chat user #5556',
      })
    ).toBeNull()
  })

  it('returns null when there is no participant or identifier', () => {
    expect(formatParticipantIdentifier(null)).toBeNull()
    expect(formatParticipantIdentifier(phoneParticipant({ identifier: '   ' }))).toBeNull()
  })
})

describe('pickThreadCounterparty', () => {
  const candidate = (
    identifier: string,
    overrides: Partial<ThreadTitleCandidate> = {}
  ): ThreadTitleCandidate => ({
    name: null,
    identifier,
    identifierType: 'PHONE',
    displayName: identifier,
    isInternal: false,
    ...overrides,
  })

  it('skips the channel own number on an outbound-last SMS thread', () => {
    // `isInternal` is false for every phone participant, so the channel's own
    // identifier is the only thing that can tell us apart from the customer.
    const us = candidate('+15550001111')
    const them = candidate('+15102055536')
    expect(pickThreadCounterparty([us, them], '+15550001111')).toBe(them)
  })

  it('matches the self identifier case- and whitespace-insensitively', () => {
    const us = candidate('support@auxx.ai', { identifierType: 'EMAIL' })
    const them = candidate('ada@example.com', { identifierType: 'EMAIL' })
    expect(pickThreadCounterparty([us, them], '  SUPPORT@auxx.ai ')).toBe(them)
  })

  it('prefers the first external when no self identifier is known', () => {
    const internal = candidate('team@auxx.ai', { identifierType: 'EMAIL', isInternal: true })
    const external = candidate('ada@example.com', { identifierType: 'EMAIL' })
    expect(pickThreadCounterparty([internal, external])).toBe(external)
  })

  it('falls back to the only participant rather than returning nothing', () => {
    const us = candidate('+15550001111')
    expect(pickThreadCounterparty([us], '+15550001111')).toBe(us)
  })

  it('ignores unresolved participants and returns undefined when there are none', () => {
    const them = candidate('+15102055536')
    expect(pickThreadCounterparty([undefined, them])).toBe(them)
    expect(pickThreadCounterparty([undefined, undefined])).toBeUndefined()
  })
})

describe('resolveThreadTitle', () => {
  it('prefers a real subject over any participant fallback', () => {
    expect(
      resolveThreadTitle({
        subject: 'Where is my order?',
        integrationProvider: 'openphone',
        participant: phoneParticipant({ name: 'Ada Lovelace' }),
      })
    ).toBe('Where is my order?')
  })

  it('trims a padded subject rather than treating it as empty', () => {
    expect(
      resolveThreadTitle({
        subject: '  Refund request  ',
        integrationProvider: 'google',
        participant: emailParticipant(),
      })
    ).toBe('Refund request')
  })

  it('falls back to the contact name on a subject-less channel', () => {
    expect(
      resolveThreadTitle({
        subject: '',
        integrationProvider: 'openphone',
        participant: phoneParticipant({ name: 'Ada Lovelace', displayName: 'Ada Lovelace' }),
      })
    ).toBe('Ada Lovelace')
  })

  it('falls back to a formatted phone number when there is no name', () => {
    expect(
      resolveThreadTitle({
        subject: '',
        integrationProvider: 'sms',
        participant: phoneParticipant(),
      })
    ).toBe('+1 510 205 5536')
  })

  it('falls back to displayName when the identifier is unusable (chat visitor)', () => {
    expect(
      resolveThreadTitle({
        subject: '',
        integrationProvider: 'chat',
        participant: {
          name: null,
          identifier: '0f2b8a1e-1111-2222-3333-444455556666',
          identifierType: 'CHAT_VISITOR',
          displayName: 'Chat user #5556',
        },
      })
    ).toBe('Chat user #5556')
  })

  it('returns null on a subject-less channel whose participant has not resolved yet', () => {
    expect(resolveThreadTitle({ subject: '', integrationProvider: 'sms' })).toBeNull()
    expect(
      resolveThreadTitle({ subject: '', integrationProvider: 'sms', participant: null })
    ).toBeNull()
  })

  it('leaves email threads with a genuinely empty subject to the caller', () => {
    expect(
      resolveThreadTitle({
        subject: '',
        integrationProvider: 'google',
        participant: emailParticipant({ name: 'Ada Lovelace' }),
      })
    ).toBeNull()
    expect(
      resolveThreadTitle({
        subject: null,
        integrationProvider: 'outlook',
        participant: emailParticipant({ name: 'Ada Lovelace' }),
      })
    ).toBeNull()
  })

  it('leaves an unknown provider with an empty subject to the caller', () => {
    expect(
      resolveThreadTitle({
        subject: '',
        integrationProvider: null,
        participant: phoneParticipant({ name: 'Ada Lovelace' }),
      })
    ).toBeNull()
  })
})
