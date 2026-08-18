// apps/web/src/components/threads/utils/participant-label.test.ts

import { describe, expect, it } from 'vitest'
import { type LabelParticipant, participantInitials, participantLabel } from './participant-label'

const phone = (overrides: Partial<LabelParticipant> = {}): LabelParticipant => ({
  name: null,
  identifier: '+15102055536',
  identifierType: 'PHONE',
  displayName: '+15102055536',
  initials: '',
  contactName: null,
  isInternal: false,
  ...overrides,
})

const email = (overrides: Partial<LabelParticipant> = {}): LabelParticipant => ({
  name: 'Ada Lovelace',
  identifier: 'ada@example.com',
  identifierType: 'EMAIL',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  contactName: null,
  isInternal: false,
  ...overrides,
})

const chatVisitor = (overrides: Partial<LabelParticipant> = {}): LabelParticipant => ({
  name: null,
  identifier: '0f2b8a1e-1111-2222-3333-444455556666',
  identifierType: 'CHAT_VISITOR',
  displayName: 'Chat user #5556',
  initials: '#5556',
  contactName: null,
  isInternal: false,
  ...overrides,
})

describe('participantLabel', () => {
  it('lets the linked contact name win over the header-derived one', () => {
    expect(participantLabel(email({ contactName: 'Countess Lovelace' }))).toBe('Countess Lovelace')
  })

  it('falls back to the header-derived name without a contact', () => {
    expect(participantLabel(email())).toBe('Ada Lovelace')
  })

  it('formats a nameless phone as PHONE_INTL instead of raw E.164', () => {
    expect(participantLabel(phone())).toBe('+1 510 205 5536')
  })

  it('a contact name on a phone participant beats the formatted number', () => {
    expect(participantLabel(phone({ contactName: 'Bruno Klooth' }))).toBe('Bruno Klooth')
  })

  it('ignores contactName on internal participants', () => {
    // Their name is pinned to the org member profile at ingest; a stray
    // auto-created contact must not rename a teammate.
    expect(
      participantLabel(
        email({
          name: 'Support Team',
          displayName: 'Support Team',
          contactName: 'Wrong Contact',
          isInternal: true,
        })
      )
    ).toBe('Support Team')
  })

  it('keeps the friendly chat handle for nameless chat visitors', () => {
    expect(participantLabel(chatVisitor())).toBe('Chat user #5556')
  })

  it('tolerates slices without contactName/isInternal (pre-enrichment payloads)', () => {
    const legacy: LabelParticipant = {
      name: null,
      identifier: 'ada@example.com',
      identifierType: 'EMAIL',
      displayName: 'ada@example.com',
      initials: '',
    }
    expect(participantLabel(legacy)).toBe('ada@example.com')
  })
})

describe('participantInitials', () => {
  it('derives initials from the contact name when it wins the label', () => {
    // A stored `BS` from headers must not pair with a renamed contact label.
    expect(
      participantInitials(email({ name: 'BS', initials: 'BS', contactName: 'Bruno Klooth' }))
    ).toBe('BK')
  })

  it('keeps the persisted initials when the contact name does not win', () => {
    expect(participantInitials(email())).toBe('AL')
    expect(participantInitials(chatVisitor())).toBe('#5556')
  })

  it('keeps persisted initials for internal participants regardless of contactName', () => {
    expect(
      participantInitials(email({ initials: 'ST', contactName: 'Wrong Contact', isInternal: true }))
    ).toBe('ST')
  })

  it('returns ? for a missing participant', () => {
    expect(participantInitials(null)).toBe('?')
    expect(participantInitials(undefined)).toBe('?')
  })
})
