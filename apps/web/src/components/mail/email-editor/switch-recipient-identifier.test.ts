// apps/web/src/components/mail/email-editor/switch-recipient-identifier.test.ts
//
// The chip menu's switch is IN PLACE. What that has to mean, and what these
// tests pin: the chip keeps its `id` (the badge list keys on it and `onRemove`
// filters on it), its field, its index, its `name` and its `recordId` — because
// the address changed and the person did not.

import { describe, expect, it } from 'vitest'
import { switchRecipientIdentifier } from './switch-recipient-identifier'
import type { Recipients } from './types'

const jane = {
  id: 'chip-1',
  identifier: 'jane@corp.com',
  identifierType: 'EMAIL' as const,
  name: 'Jane Smith',
  recordId: 'c1',
}
const ada = {
  id: 'chip-2',
  identifier: 'ada@x.com',
  identifierType: 'EMAIL' as const,
  name: 'Ada Lovelace',
}

function recipients(overrides: Partial<Recipients> = {}): Recipients {
  return { TO: [], CC: [], BCC: [], ...overrides }
}

describe('switchRecipientIdentifier', () => {
  it('replaces the identifier while keeping id, position, name and recordId', () => {
    const before = recipients({ TO: [jane, ada] })

    const after = switchRecipientIdentifier(before, 'TO', 'chip-1', {
      identifier: 'j.smith@corp.com',
      identifierType: 'EMAIL',
    })

    expect(after.TO).toEqual([{ ...jane, identifier: 'j.smith@corp.com' }, ada])
    // Position, not just membership: a remove-then-add would put it last.
    expect(after.TO[0]?.id).toBe('chip-1')
  })

  it('leaves the other fields untouched', () => {
    const before = recipients({ TO: [jane], CC: [ada] })

    const after = switchRecipientIdentifier(before, 'TO', 'chip-1', {
      identifier: 'j.smith@corp.com',
      identifierType: 'EMAIL',
    })

    expect(after.CC).toBe(before.CC)
    expect(after.BCC).toBe(before.BCC)
  })

  it('switches identifierType too — a channel switch can change the shape', () => {
    const before = recipients({ TO: [jane] })

    const after = switchRecipientIdentifier(before, 'TO', 'chip-1', {
      identifier: '+14155551234',
      identifierType: 'PHONE',
    })

    expect(after.TO[0]).toMatchObject({ identifier: '+14155551234', identifierType: 'PHONE' })
  })

  it('returns the SAME object when the address is already the committed one', () => {
    const before = recipients({ TO: [jane] })

    const after = switchRecipientIdentifier(before, 'TO', 'chip-1', {
      identifier: 'jane@corp.com',
      identifierType: 'EMAIL',
    })

    // Identity, not equality: a no-op switch must not re-render the field.
    expect(after).toBe(before)
  })

  it('returns the SAME object for an unknown chip id', () => {
    const before = recipients({ TO: [jane] })

    expect(
      switchRecipientIdentifier(before, 'TO', 'chip-nope', {
        identifier: 'j.smith@corp.com',
        identifierType: 'EMAIL',
      })
    ).toBe(before)
  })

  it('refuses to switch onto an address another chip in the field already holds', () => {
    // The menu renders that row disabled, so this is only reachable if the two
    // ever disagree — and collapsing two chips into one is not a switch.
    const before = recipients({ TO: [jane, { ...ada, identifier: 'j.smith@corp.com' }] })

    expect(
      switchRecipientIdentifier(before, 'TO', 'chip-1', {
        identifier: 'j.smith@corp.com',
        identifierType: 'EMAIL',
      })
    ).toBe(before)
  })

  it('allows the same address to exist in a DIFFERENT field', () => {
    const before = recipients({ TO: [jane], CC: [{ ...ada, identifier: 'j.smith@corp.com' }] })

    const after = switchRecipientIdentifier(before, 'TO', 'chip-1', {
      identifier: 'j.smith@corp.com',
      identifierType: 'EMAIL',
    })

    expect(after.TO[0]?.identifier).toBe('j.smith@corp.com')
  })
})
