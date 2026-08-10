// packages/lib/src/mail-unsubscribe/unsubscribe-authority.test.ts
// The §7.1 divergence, pinned: unsubscribe needs INBOX READ and nothing else.
// If someone ever reintroduces an `automationRules.manage` requirement here,
// these tests are what fail — the whole point of §7.1 is that stopping a
// newsletter must not be gated on admin rank (mail guide / filters invariant 7).
//
// The rung itself is pinned by `readsAtRung` below, which walks the real mail
// ladder (`none < metadata < identity < read < admin`, no `edit` — that omission
// is deliberate, see `instance-access.ts`). v2 plan §2.1 / user decision
// 2026-08-10 moved this gate from the `edit` threshold — which on that sparse
// ladder resolves to `admin` and made unsubscribe exactly as strict as authoring
// a standing filter — down to `read`, where mail already puts reply and assign.

import { describe, expect, it } from 'vitest'
import {
  assertCanUnsubscribe,
  canUnsubscribeOnInbox,
  isSharedInbox,
  type UnsubscribeAuthorityCapabilities,
  type UnsubscribeInbox,
} from './unsubscribe-authority'

const writesToNothing = { canViewInstance: () => false }
const writesToEverything = { canViewInstance: () => true }

/** The mail ladder, ascending. `edit` is absent ON PURPOSE — `instance-access.ts`. */
const INBOX_RUNGS = ['none', 'metadata', 'identity', 'read', 'admin'] as const
type InboxRung = (typeof INBOX_RUNGS)[number]

/**
 * A member composing exactly `rung` on every inbox, as the real `CapabilitySet`
 * would answer: `canViewInstance` is the `>= read` threshold.
 */
function readsAtRung(rung: InboxRung): UnsubscribeAuthorityCapabilities {
  const satisfiesRead = INBOX_RUNGS.indexOf(rung) >= INBOX_RUNGS.indexOf('read')
  return { canViewInstance: () => satisfiesRead }
}

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

describe('shared inbox — inbox READ authority, and NOTHING else', () => {
  it('allows a member with inbox read, holding no automation grant', () => {
    expect(canUnsubscribeOnInbox(shared, 'usr_1', writesToEverything)).toBe(true)
  })

  it('denies a member without inbox read', () => {
    expect(canUnsubscribeOnInbox(shared, 'usr_1', writesToNothing)).toBe(false)
  })

  it('asks about THIS inbox, not inbox read in general', () => {
    const capabilities = { canViewInstance: (_key: 'inbox', id: string) => id === 'ibx_other' }
    expect(canUnsubscribeOnInbox(shared, 'usr_1', capabilities)).toBe(false)
  })

  it('assertCanUnsubscribe throws a ForbiddenError, never a TRPCError', () => {
    expect(() => assertCanUnsubscribe(shared, 'usr_1', writesToNothing)).toThrow(
      /permission to unsubscribe/
    )
    expect(() => assertCanUnsubscribe(shared, 'usr_1', writesToEverything)).not.toThrow()
  })
})

describe('shared inbox — the rung is READ, not admin (v2 §2.1)', () => {
  it.each(['read', 'admin'] as const)('allows a member composing %s', (rung) => {
    expect(canUnsubscribeOnInbox(shared, 'usr_1', readsAtRung(rung))).toBe(true)
  })

  it.each(['none', 'metadata', 'identity'] as const)('denies a member composing %s', (rung) => {
    expect(canUnsubscribeOnInbox(shared, 'usr_1', readsAtRung(rung))).toBe(false)
  })

  it('does NOT require admin — a plain reader may stop a newsletter', () => {
    // The regression this guards: asking the `edit` threshold on a ladder with no
    // `edit` rung silently resolves to `admin`, collapsing §7.1's deliberately
    // LOOSER gate into the strict half of the filter-authoring one.
    expect(canUnsubscribeOnInbox(shared, 'usr_1', readsAtRung('read'))).toBe(true)
    expect(() => assertCanUnsubscribe(shared, 'usr_1', readsAtRung('read'))).not.toThrow()
  })

  it("a reader still cannot touch another member's personal mailbox", () => {
    // Loosening the SHARED branch must not reach across the personal one: that
    // branch keys on the inbox DEFINITION and never consults a capability at all.
    expect(canUnsubscribeOnInbox(personal, 'usr_other', readsAtRung('admin'))).toBe(false)
    expect(() => assertCanUnsubscribe(personal, 'usr_other', readsAtRung('read'))).toThrow(
      /permission to unsubscribe/
    )
  })
})

describe('isSharedInbox — drives the blast-radius confirm + the audit row', () => {
  it('is true only for a genuinely shared inbox', () => {
    expect(isSharedInbox(shared)).toBe(true)
    expect(isSharedInbox(personal)).toBe(false)
    expect(isSharedInbox({ ...shared, isPersonal: true })).toBe(false)
  })
})
