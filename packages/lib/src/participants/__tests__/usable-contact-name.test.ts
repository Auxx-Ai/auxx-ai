// packages/lib/src/participants/__tests__/usable-contact-name.test.ts
//
// The ONE normalization behind contact-name precedence, shared by the
// `ParticipantMeta` fetch path, the realtime bridge in the web participant
// store, and the search router's label helper.

import { describe, expect, it } from 'vitest'
import { usableContactName } from '../client'

describe('usableContactName', () => {
  it('returns the trimmed name when it is a real name', () => {
    expect(usableContactName('  Bruno Klooth ', '+18889155797')).toBe('Bruno Klooth')
  })

  it('returns null for null/undefined/empty/whitespace', () => {
    expect(usableContactName(null, '+18889155797')).toBeNull()
    expect(usableContactName(undefined, '+18889155797')).toBeNull()
    expect(usableContactName('', '+18889155797')).toBeNull()
    expect(usableContactName('   ', '+18889155797')).toBeNull()
  })

  it('returns null when the name is the identifier echoed back', () => {
    expect(usableContactName('+18889155797', '+18889155797')).toBeNull()
    expect(usableContactName('ada@acme.io', 'ada@acme.io')).toBeNull()
  })

  it('compares case-insensitively and trimmed', () => {
    expect(usableContactName(' ADA@Acme.IO ', 'ada@acme.io')).toBeNull()
    expect(usableContactName('ada@acme.io', '  ADA@ACME.IO ')).toBeNull()
  })

  it('keeps a name that merely CONTAINS the identifier', () => {
    expect(usableContactName('ada@acme.io (Ada)', 'ada@acme.io')).toBe('ada@acme.io (Ada)')
  })

  it('treats a missing identifier as "any non-blank name is usable"', () => {
    expect(usableContactName('Bruno', null)).toBe('Bruno')
    expect(usableContactName('Bruno', undefined)).toBe('Bruno')
  })
})
