// packages/lib/src/permissions/visibility/visibility.test.ts

import { describe, expect, it } from 'vitest'
import { maxRung, satisfiesRung } from '../capabilities/rung'
import type { AutomationVisibility, ThreadVisibilityInput, UserInstanceGrants } from './context'
import { isAutomationViewer, isSystemViewer, isUserViewer, SYSTEM_VISIBILITY } from './context'
import { automationLens, effectiveLens, effectiveLensBatch, inboxLensFor } from './effective-lens'
import { type Lens, normalizeLens } from './lens'
import { redactMessage, redactMessagePatch, redactThreadMeta, redactThreadPatch } from './redact'

const INBOX = 'inbox_1'
const PERSONAL = 'inbox_personal'

function vis(over: Partial<UserInstanceGrants> = {}): UserInstanceGrants {
  return {
    userId: 'u1',
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    grants: {},
    defEntityTypes: {},
    ...over,
  }
}

function thread(over: Partial<ThreadVisibilityInput> = {}): ThreadVisibilityInput {
  return {
    threadId: 't1',
    inboxId: INBOX,
    assigneeId: null,
    primaryEntityInstanceId: null,
    participantContactIds: [],
    ...over,
  }
}

describe('lens comparators', () => {
  // `satisfiesLens` / `maxLens` are DELETED (plan v3/03 §11): `Lens` is now a
  // narrowing of `Rung`, so the shared comparators accept a lens unchanged. The
  // assertions are kept, pointed at the survivors — that is what proves the two
  // ladders really are one and not merely documented as such.
  it('orders none < metadata < identity < read', () => {
    expect(satisfiesRung('read', 'identity')).toBe(true)
    expect(satisfiesRung('metadata', 'identity')).toBe(false)
    expect(maxRung<Lens>('metadata', 'identity')).toBe('identity')
    expect(maxRung<Lens>('read', 'none')).toBe('read')
  })
})

describe('normalizeLens', () => {
  it('passes valid scalar lenses through', () => {
    expect(normalizeLens('none')).toBe('none')
    expect(normalizeLens('metadata')).toBe('metadata')
    expect(normalizeLens('identity')).toBe('identity')
    expect(normalizeLens('read')).toBe('read')
  })

  it('unwraps SINGLE_SELECT one-element arrays', () => {
    // Arrays poison strict comparisons downstream: ['none'] !== 'none' skips
    // the restricted-inbox drop, ['read'] !== 'read' redacts full viewers.
    expect(normalizeLens(['identity'])).toBe('identity')
    expect(normalizeLens(['none'])).toBe('none')
    expect(normalizeLens(['read'])).toBe('read')
  })

  it('falls back on garbage', () => {
    expect(normalizeLens(undefined)).toBe('read')
    expect(normalizeLens(null)).toBe('read')
    expect(normalizeLens([])).toBe('read')
    expect(normalizeLens('FULL')).toBe('read')
    expect(normalizeLens(['identity', 'read'])).toBe('identity')
    expect(normalizeLens('bogus', 'none')).toBe('none')
  })
})

// Plan 40 §4.2 deleted BOTH `isAdmin` short-circuits from the evaluator. Rank is
// no longer an input: an admin's reach arrives entirely through the composed
// `inboxLens` (the `Area.inboxes` fallback + their rows + §4.4's mail-admin
// `metadata` floor on others' personal mailboxes), which is what
// `composeUserInstanceGrants` builds. These tests pin that the evaluator itself
// stays rank-blind.
describe('effectiveLens — rank is not an input (plan 40 §4.2)', () => {
  it('an admin flag alone confers NOTHING on a normal inbox', () => {
    expect(effectiveLens(vis({ isAdmin: true }), thread())).toBe('none')
  })

  it('an admin flag alone confers NOTHING on a null-inbox thread', () => {
    expect(effectiveLens(vis({ isAdmin: true }), thread({ inboxId: null }))).toBe('none')
  })

  it('an admin reads a shared inbox through the composed floor', () => {
    // What `composeUserInstanceGrants` produces for a default admin: the
    // `Area.inboxes` fallback on a row-less shared inbox.
    const v = vis({ isAdmin: true, isMailAdmin: true, inboxLens: { [INBOX]: 'read' } })
    expect(effectiveLens(v, thread())).toBe('read')
  })

  it("a mail admin is capped at metadata on another user's personal inbox", () => {
    // The §4.4 floor is composed INTO `inboxLens`, so the evaluator needs no branch.
    const v = vis({
      isAdmin: true,
      isMailAdmin: true,
      personalInboxIds: { [PERSONAL]: true },
      inboxLens: { [PERSONAL]: 'metadata' },
    })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL }))).toBe('metadata')
  })

  it('a mail admin on a personal inbox is raised by an explicit thread grant', () => {
    const v = vis({
      isAdmin: true,
      isMailAdmin: true,
      personalInboxIds: { [PERSONAL]: true },
      inboxLens: { [PERSONAL]: 'metadata' },
      grants: { thread: { t1: 'identity' } },
    })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL }))).toBe('identity')
  })

  it('the owner of a personal inbox resolves to full via their Manager inbox floor', () => {
    const v = vis({ inboxLens: { [PERSONAL]: 'read' } })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL }))).toBe('read')
  })

  it('assignment still beats a metadata personal floor (ungated collaboration)', () => {
    const v = vis({
      userId: 'u1',
      isMailAdmin: true,
      personalInboxIds: { [PERSONAL]: true },
      inboxLens: { [PERSONAL]: 'metadata' },
    })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL, assigneeId: 'u1' }))).toBe('read')
  })
})

describe('effectiveLens — non-admin derivations', () => {
  it('no access → none', () => {
    expect(effectiveLens(vis(), thread())).toBe('none')
  })

  it('assignment ⇒ full even on a none inbox', () => {
    const v = vis({ userId: 'u1' })
    expect(effectiveLens(v, thread({ inboxId: null, assigneeId: 'u1' }))).toBe('read')
  })

  it('a different assignee does not grant access', () => {
    expect(effectiveLens(vis({ userId: 'u1' }), thread({ assigneeId: 'u2' }))).toBe('none')
  })

  it.each(['metadata', 'identity', 'read'] as const)('inbox floor %s applies', (lens) => {
    expect(effectiveLens(vis({ inboxLens: { [INBOX]: lens } }), thread())).toBe(lens)
  })

  it('thread grant applies', () => {
    expect(
      effectiveLens(vis({ grants: { thread: { t1: 'identity' } } }), thread({ inboxId: null }))
    ).toBe('identity')
  })

  // ── The CASCADE CAP (plan v3/03 §13.1, decided 2026-07-29) ──────────────────
  //
  // These two replace a single `entity grant applies to the primary entity` case
  // that asserted the UNCAPPED behaviour: any def, any rung, full cascade. That
  // was never a decision — it was an accident of the keyspace, and the second
  // case below is the one it got wrong.

  it('a TICKET-LIKE def derives thread `read` — the conversation IS the ticket', () => {
    const v = vis({
      grants: { def_ticket: { tkt_1: 'read' } },
      defEntityTypes: { def_ticket: 'ticket' },
    })
    expect(effectiveLens(v, thread({ inboxId: null, primaryEntityInstanceId: 'tkt_1' }))).toBe(
      'read'
    )
  })

  it('a ticket grant ABOVE `read` still derives only `read` — the cap is a ceiling', () => {
    const v = vis({
      grants: { def_ticket: { tkt_1: 'admin' } },
      defEntityTypes: { def_ticket: 'ticket' },
    })
    expect(effectiveLens(v, thread({ inboxId: null, primaryEntityInstanceId: 'tkt_1' }))).toBe(
      'read'
    )
  })

  it('a GENERIC record def derives NOTHING — sharing the deal shares the deal', () => {
    const v = vis({ grants: { def_deal: { deal_1: 'admin' } }, defEntityTypes: { def_deal: null } })
    expect(effectiveLens(v, thread({ inboxId: null, primaryEntityInstanceId: 'deal_1' }))).toBe(
      'none'
    )
  })

  it('a def missing from `defEntityTypes` derives nothing — the fail-closed default', () => {
    const v = vis({ grants: { def_deal: { deal_1: 'admin' } } })
    expect(effectiveLens(v, thread({ inboxId: null, primaryEntityInstanceId: 'deal_1' }))).toBe(
      'none'
    )
  })

  it('the cap is applied PER DEF before the fold, so a generic def cannot out-rank a ticket', () => {
    // Both defs carry a grant on the same instance id (contrived, but it is the
    // arithmetic that matters): `max(min(rung, cap))` yields the ticket's capped
    // `read`; the old `min(max(rung), cap)` order would have folded the deal's
    // `admin` in first and clamped THAT, giving `read` off a def that must
    // derive nothing at all.
    const v = vis({
      grants: { def_deal: { x1: 'admin' }, def_ticket: { x1: 'read' } },
      defEntityTypes: { def_deal: null, def_ticket: 'ticket' },
    })
    expect(effectiveLens(v, thread({ inboxId: null, primaryEntityInstanceId: 'x1' }))).toBe('read')

    // …and with the ticket removed, nothing survives.
    const generic = vis({
      grants: { def_deal: { x1: 'admin' } },
      defEntityTypes: { def_deal: null },
    })
    expect(effectiveLens(generic, thread({ inboxId: null, primaryEntityInstanceId: 'x1' }))).toBe(
      'none'
    )
  })

  it('contact grant applies to a participant contact', () => {
    const v = vis({ grants: { contact: { c1: 'metadata' } } })
    expect(effectiveLens(v, thread({ inboxId: null, participantContactIds: ['c9', 'c1'] }))).toBe(
      'metadata'
    )
  })

  it('takes the max across inbox floor and a thread grant', () => {
    const v = vis({ inboxLens: { [INBOX]: 'metadata' }, grants: { thread: { t1: 'read' } } })
    expect(effectiveLens(v, thread())).toBe('read')
  })

  it('ignores type-level access — a contact not in contactGrants yields none', () => {
    // The context only ever carries instance-level grants; a "view all
    // contacts" type grant must never populate contactGrants (provider concern).
    const v = vis({ grants: { contact: { c1: 'read' } } })
    expect(effectiveLens(v, thread({ inboxId: null, participantContactIds: ['c2'] }))).toBe('none')
  })

  it('null inbox with no derivations → none', () => {
    expect(effectiveLens(vis(), thread({ inboxId: null }))).toBe('none')
  })
})

describe('effectiveLensBatch', () => {
  it('maps each thread to its lens', () => {
    const v = vis({ inboxLens: { [INBOX]: 'identity' } })
    const out = effectiveLensBatch(v, [
      thread({ threadId: 'a' }),
      thread({ threadId: 'b', inboxId: null }),
    ])
    expect(out.get('a')).toBe('identity')
    expect(out.get('b')).toBe('none')
  })
})

describe('system viewer', () => {
  it('is narrowable', () => {
    expect(isSystemViewer(SYSTEM_VISIBILITY)).toBe(true)
    expect(isSystemViewer(vis())).toBe(false)
  })
})

describe('automation viewer (§8.2)', () => {
  const automation = (personal: string[] = []): AutomationVisibility => ({
    kind: 'automation',
    personalInboxIds: Object.fromEntries(personal.map((id) => [id, true as const])),
  })

  it('narrows distinctly from system and user viewers', () => {
    expect(isAutomationViewer(automation())).toBe(true)
    expect(isAutomationViewer(SYSTEM_VISIBILITY)).toBe(false)
    expect(isAutomationViewer(vis())).toBe(false)
    expect(isSystemViewer(automation())).toBe(false)
    expect(isUserViewer(automation())).toBe(false)
    expect(isUserViewer(vis())).toBe(true)
  })

  it('reads full on org inboxes and null-inbox threads', () => {
    expect(automationLens(automation(), thread())).toBe('read')
    expect(automationLens(automation(), thread({ inboxId: null }))).toBe('read')
  })

  it('has zero access to personal inboxes — assignment does not raise it', () => {
    const a = automation([PERSONAL])
    expect(automationLens(a, thread({ inboxId: PERSONAL }))).toBe('none')
    expect(automationLens(a, thread({ inboxId: PERSONAL, assigneeId: 'u1' }))).toBe('none')
    expect(automationLens(a, thread())).toBe('read')
  })
})

const META: any = {
  id: 't1',
  subject: 'Secret subject',
  status: 'OPEN',
  isUnread: true,
  latestMessageId: 'm1',
  messageCount: 3,
  tagIds: [],
  participants: ['from:p1', 'to:p2'],
}

describe('redactThreadMeta', () => {
  it('full passes through unchanged', () => {
    expect(redactThreadMeta(META, 'read')).toBe(META)
  })

  it('subject keeps subject but blanks full-only fields', () => {
    const r = redactThreadMeta(META, 'identity')
    expect(r.subject).toBe('Secret subject')
    expect(r.isUnread).toBe(false)
    expect(r.latestMessageId).toBeNull()
    expect(r.messageCount).toBe(3)
  })

  it('metadata blanks subject and full-only fields', () => {
    const r = redactThreadMeta(META, 'metadata')
    expect(r.subject).toBe('')
    expect(r.isUnread).toBe(false)
    expect(r.latestMessageId).toBeNull()
  })

  it('keeps envelope participants at every lens (§2.2 tier table)', () => {
    expect(redactThreadMeta(META, 'identity').participants).toEqual(['from:p1', 'to:p2'])
    expect(redactThreadMeta(META, 'metadata').participants).toEqual(['from:p1', 'to:p2'])
    expect(redactThreadPatch({ participants: ['from:p1'] } as any, 'metadata')).toEqual({
      participants: ['from:p1'],
    })
  })
})

describe('redactThreadPatch (allowlist)', () => {
  it('drops full-only + subject keys at metadata', () => {
    const patch = { subject: 'x', isUnread: true, status: 'CLOSED', tagIds: [] } as any
    const r = redactThreadPatch(patch, 'metadata')
    expect(r).toEqual({ status: 'CLOSED', tagIds: [] })
  })

  it('keeps subject at subject lens but still drops full-only', () => {
    const r = redactThreadPatch({ subject: 'x', isUnread: true } as any, 'identity')
    expect(r).toEqual({ subject: 'x' })
  })

  it('drops an unclassified new field below full (allowlist)', () => {
    const r = redactThreadPatch({ status: 'OPEN', brandNewLeak: 'oops' } as any, 'metadata')
    expect(r).toEqual({ status: 'OPEN' })
  })

  it('none yields empty', () => {
    expect(redactThreadPatch({ status: 'OPEN' } as any, 'none')).toEqual({})
  })
})

describe('redactMessage', () => {
  const MESSAGE = {
    id: 'm1',
    subject: 'Hi',
    snippet: 'preview…',
    textHtml: '<p>body</p>',
    textPlain: 'body',
    htmlBodyStorageLocationId: 'loc_1',
    attachments: [{ id: 'a1' }],
    hasAttachments: true,
    isInbound: true,
  }

  it('full passes through unchanged', () => {
    expect(redactMessage(MESSAGE, 'read')).toBe(MESSAGE)
  })

  it('subject (envelope tier) blanks content, keeps attachments an array', () => {
    const r = redactMessage(MESSAGE, 'identity')
    expect(r.subject).toBe('Hi')
    expect(r.snippet).toBeNull()
    expect(r.textHtml).toBeNull()
    expect(r.textPlain).toBeNull()
    expect(r.htmlBodyStorageLocationId).toBeNull()
    expect(r.attachments).toEqual([])
    expect(r.isInbound).toBe(true)
  })
})

describe('redactMessagePatch (realtime §6.2)', () => {
  it('full passes through unchanged', () => {
    const patch = { snippet: 'preview', sendStatus: 'SENT' }
    expect(redactMessagePatch(patch, 'read')).toBe(patch)
  })

  it('subject DROPS content keys (never blanks them onto the store)', () => {
    const r = redactMessagePatch(
      { snippet: 'preview', attachments: [{ id: 'a1' }], sendStatus: 'SENT' },
      'identity'
    )
    expect(r).toEqual({ sendStatus: 'SENT' })
    expect('snippet' in r).toBe(false)
    expect('attachments' in r).toBe(false)
  })
})

describe('inboxLensFor', () => {
  it('has no admin short-circuit — it is a plain floor read (plan 40 §4.2)', () => {
    expect(inboxLensFor(vis({ isAdmin: true, isMailAdmin: true }), INBOX)).toBe('none')
  })

  it('agrees with effectiveLens on a mail admin’s personal-mailbox cap', () => {
    // These two used to DISAGREE: `inboxLensFor` returned `none` while
    // `effectiveLens` returned `metadata`. Both now read the composed floor.
    const v = vis({
      isAdmin: true,
      isMailAdmin: true,
      personalInboxIds: { [PERSONAL]: true },
      inboxLens: { [PERSONAL]: 'metadata' },
    })
    expect(inboxLensFor(v, PERSONAL)).toBe('metadata')
    expect(effectiveLens(v, thread({ inboxId: PERSONAL }))).toBe('metadata')
  })

  it('member reads the composed inbox floor, none when absent', () => {
    const v = vis({ inboxLens: { [INBOX]: 'identity' } })
    expect(inboxLensFor(v, INBOX)).toBe('identity')
    expect(inboxLensFor(v, 'other_inbox')).toBe('none')
  })
})
