// apps/web/src/components/mail-filters/utils/prefill-conditions.test.ts

import { describe, expect, it } from 'vitest'
import { buildThreadPrefill } from './prefill-conditions'

const EMAIL = { identifier: 'ada@acme.com', identifierType: 'EMAIL' as const }
const PHONE = { identifier: '+15102055536', identifierType: 'PHONE' as const }

const conditionOn = (result: ReturnType<typeof buildThreadPrefill>, fieldId: string) =>
  result.conditions.find((c) => c.fieldId === fieldId)

describe('buildThreadPrefill — the sender arm is chosen by identifierType', () => {
  it('prefills an email sender', () => {
    const result = buildThreadPrefill({ participant: EMAIL, integrationProvider: 'google' })

    expect(conditionOn(result, 'from')).toMatchObject({ operator: 'is', value: 'ada@acme.com' })
    expect(result.name).toBe('Mail from ada@acme.com')
    expect(result.notes).toEqual([])
  })

  it('prefills a PHONE sender — the bug this replaced dropped it silently', () => {
    // The old test was `identifier.includes('@')`, so every SMS thread opened
    // the dialog with no sender condition and no name: the half the user came
    // for. `from` has no type predicate, so `from is +1…` is a real filter.
    const result = buildThreadPrefill({ participant: PHONE, integrationProvider: 'openphone' })

    expect(conditionOn(result, 'from')).toMatchObject({ operator: 'is', value: '+15102055536' })
    expect(result.notes).toEqual([])
    expect(result.name).toMatch(/^Texts from /)
    // Named in display format, filtered in E.164 — the value is the routing key.
    expect(result.name).not.toBe('Texts from +15102055536')
  })

  for (const identifierType of ['FACEBOOK_PSID', 'INSTAGRAM_IGSID', 'CHAT_VISITOR'] as const) {
    it(`prefills NO sender condition for ${identifierType}, and says why`, () => {
      // Technically valid, practically useless: the id is opaque and per-app
      // (per-session for chat), so a filter on it matches one conversation
      // forever. Reported in the banner rather than dropped in silence.
      const result = buildThreadPrefill({
        participant: { identifier: 'psid_9912873', identifierType },
        integrationProvider: 'facebook',
        inboxName: 'Chat Support',
      })

      expect(conditionOn(result, 'from')).toBeUndefined()
      expect(result.notes).toHaveLength(1)
      expect(result.notes[0]).toMatch(/no sender condition/i)
      expect(result.name).toBe('Conversations in Chat Support')
    })
  }

  it('prefills nothing at all when the counterparty has not resolved', () => {
    const result = buildThreadPrefill({ participant: null, integrationProvider: 'google' })

    expect(result.conditions).toEqual([])
    expect(result.name).toBeUndefined()
    expect(result.notes).toEqual([])
  })
})

describe('buildThreadPrefill — the subject arm is gated on the channel capability', () => {
  it('adds `subject contains` on a channel that carries subjects', () => {
    const result = buildThreadPrefill({
      participant: EMAIL,
      subject: 'Order #1024',
      integrationProvider: 'google',
    })

    expect(conditionOn(result, 'subject')).toMatchObject({
      operator: 'contains',
      value: 'Order #1024',
    })
  })

  it('skips it on a channel that does not — by decision, not by empty string', () => {
    // SMS threads happen to store `subject = ''` today, which skipped this arm
    // by accident. `PLATFORM_CAPABILITIES.subject` makes it deliberate, and
    // keeps it right for a channel that has a subject we would not filter on.
    const result = buildThreadPrefill({
      participant: PHONE,
      subject: 'Some carrier-supplied subject',
      integrationProvider: 'openphone',
    })

    expect(conditionOn(result, 'subject')).toBeUndefined()
    expect(conditionOn(result, 'from')).toBeDefined()
  })

  it('treats an unknown provider as subject-carrying', () => {
    const result = buildThreadPrefill({
      participant: EMAIL,
      subject: 'Order #1024',
      integrationProvider: null,
    })

    expect(conditionOn(result, 'subject')).toBeDefined()
  })
})
