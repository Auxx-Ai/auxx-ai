// packages/lib/src/participants/__tests__/display-info.test.ts
//
// contact-name-precedence plan Phase 5 — `calculateParticipantDisplayInfo` is
// the exported read-time repair (extracted from the service's private
// `_calculateDisplayInfo`) that both `getParticipantMetaBatch` and the search
// router use, so a nullable stored `displayName` or a legacy CHAT_VISITOR row
// carrying its raw session uuid never reaches a label.

import { describe, expect, it } from 'vitest'
import { generateVisitorName } from '../../chat/visitor-naming'
import { calculateParticipantDisplayInfo } from '../display-info'

const SESSION_UUID = '7c0e8605-4a2b-4c3d-9e1f-d1a566d4354b'

describe('calculateParticipantDisplayInfo', () => {
  it('prefers the stored name and derives initials from it', () => {
    const { displayName, initials } = calculateParticipantDisplayInfo(
      'Anna Klooth',
      'anna@example.com',
      'EMAIL'
    )
    expect(displayName).toBe('Anna Klooth')
    expect(initials).toBe('AK')
  })

  it('falls back to the identifier when there is no name', () => {
    const { displayName, initials } = calculateParticipantDisplayInfo(
      null,
      'anna@example.com',
      'EMAIL'
    )
    expect(displayName).toBe('anna@example.com')
    expect(initials).toBe('A')
  })

  it('repairs a nameless CHAT_VISITOR to the friendly handle, never the uuid', () => {
    const { displayName } = calculateParticipantDisplayInfo(null, SESSION_UUID, 'CHAT_VISITOR')
    expect(displayName).toBe(generateVisitorName(SESSION_UUID))
    expect(displayName).not.toContain(SESSION_UUID)
  })

  it('a claimed name still beats the friendly handle on CHAT_VISITOR', () => {
    const { displayName } = calculateParticipantDisplayInfo('Bruno', SESSION_UUID, 'CHAT_VISITOR')
    expect(displayName).toBe('Bruno')
  })

  it('whitespace-only names do not count', () => {
    const { displayName } = calculateParticipantDisplayInfo('   ', '+18889155797', 'PHONE')
    expect(displayName).toBe('+18889155797')
  })

  it('answers Unknown when there is nothing at all', () => {
    const { displayName } = calculateParticipantDisplayInfo(null, null, null)
    expect(displayName).toBe('Unknown')
  })
})
