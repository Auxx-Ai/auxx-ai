// packages/lib/src/mail-unsubscribe/unsubscribe-authority.test.ts
// The §7.1 divergence, pinned: unsubscribe needs INBOX WRITE and nothing else.
// If someone ever reintroduces an `automationRules.manage` requirement here,
// these tests are what fail — the whole point of §7.1 is that stopping a
// newsletter must not be gated on admin rank (mail guide / filters invariant 7).

import { describe, expect, it } from 'vitest'
import {
  assertCanUnsubscribe,
  canUnsubscribeOnInbox,
  isSharedInbox,
  type UnsubscribeInbox,
} from './unsubscribe-authority'

const writesToNothing = { canEditInstance: () => false }
const writesToEverything = { canEditInstance: () => true }

const personal: UnsubscribeInbox = {
  id: 'ibx_personal',
  entityDefinitionKey: 'personal_inbox',
  isPersonal: true,
  ownerUserId: 'usr_owner',
}
const shared: UnsubscribeInbox = {
  id: 'ibx_shared',
  entityDefinitionKey: 'inbox',
  isPersonal: false,
  ownerUserId: null,
}

describe('personal inbox — ownership alone, no key', () => {
  it('the owner may unsubscribe while holding no instance write at all', () => {
    expect(canUnsubscribeOnInbox(personal, 'usr_owner', writesToNothing)).toBe(true)
  })

  it('nobody else may, however much authority they hold', () => {
    expect(canUnsubscribeOnInbox(personal, 'usr_other', writesToEverything)).toBe(false)
  })

  it('the legacy isPersonal marker on a SHARED def narrows to ownership, never widens', () => {
    const legacy: UnsubscribeInbox = {
      id: 'ibx_legacy',
      entityDefinitionKey: 'inbox',
      isPersonal: true,
      ownerUserId: 'usr_owner',
    }
    expect(canUnsubscribeOnInbox(legacy, 'usr_owner', writesToNothing)).toBe(true)
    // An admin composing "Inboxes: Full" must NOT reach someone's private mailbox.
    expect(canUnsubscribeOnInbox(legacy, 'usr_admin', writesToEverything)).toBe(false)
  })
})

describe('shared inbox — inbox write authority, and NOTHING else', () => {
  it('allows a member with inbox write, holding no automation grant', () => {
    expect(canUnsubscribeOnInbox(shared, 'usr_1', writesToEverything)).toBe(true)
  })

  it('denies a member without inbox write', () => {
    expect(canUnsubscribeOnInbox(shared, 'usr_1', writesToNothing)).toBe(false)
  })

  it('asks about THIS inbox, not inbox write in general', () => {
    const capabilities = { canEditInstance: (_key: 'inbox', id: string) => id === 'ibx_other' }
    expect(canUnsubscribeOnInbox(shared, 'usr_1', capabilities)).toBe(false)
  })

  it('assertCanUnsubscribe throws a ForbiddenError, never a TRPCError', () => {
    expect(() => assertCanUnsubscribe(shared, 'usr_1', writesToNothing)).toThrow(
      /permission to unsubscribe/
    )
    expect(() => assertCanUnsubscribe(shared, 'usr_1', writesToEverything)).not.toThrow()
  })
})

describe('isSharedInbox — drives the blast-radius confirm + the audit row', () => {
  it('is true only for a genuinely shared inbox', () => {
    expect(isSharedInbox(shared)).toBe(true)
    expect(isSharedInbox(personal)).toBe(false)
    expect(isSharedInbox({ ...shared, isPersonal: true })).toBe(false)
  })
})
