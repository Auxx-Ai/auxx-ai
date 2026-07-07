// packages/lib/src/permissions/visibility/visibility.test.ts

import { describe, expect, it } from 'vitest'
import type { AutomationVisibility, ThreadVisibilityInput, UserMailVisibility } from './context'
import { isAutomationViewer, isSystemViewer, isUserViewer, SYSTEM_VISIBILITY } from './context'
import { automationLens, effectiveLens, effectiveLensBatch, inboxLensFor } from './effective-lens'
import { maxLens, normalizeLens, satisfiesLens } from './lens'
import { redactMessage, redactMessagePatch, redactThreadMeta, redactThreadPatch } from './redact'

const INBOX = 'inbox_1'
const PERSONAL = 'inbox_personal'

function vis(over: Partial<UserMailVisibility> = {}): UserMailVisibility {
  return {
    userId: 'u1',
    role: 'USER',
    isAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    threadGrants: {},
    contactGrants: {},
    entityGrants: {},
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
  it('orders none < metadata < subject < full', () => {
    expect(satisfiesLens('full', 'subject')).toBe(true)
    expect(satisfiesLens('metadata', 'subject')).toBe(false)
    expect(maxLens('metadata', 'subject')).toBe('subject')
    expect(maxLens('full', 'none')).toBe('full')
  })
})

describe('normalizeLens', () => {
  it('passes valid scalar lenses through', () => {
    expect(normalizeLens('none')).toBe('none')
    expect(normalizeLens('metadata')).toBe('metadata')
    expect(normalizeLens('subject')).toBe('subject')
    expect(normalizeLens('full')).toBe('full')
  })

  it('unwraps SINGLE_SELECT one-element arrays', () => {
    // Arrays poison strict comparisons downstream: ['none'] !== 'none' skips
    // the restricted-inbox drop, ['full'] !== 'full' redacts full viewers.
    expect(normalizeLens(['subject'])).toBe('subject')
    expect(normalizeLens(['none'])).toBe('none')
    expect(normalizeLens(['full'])).toBe('full')
  })

  it('falls back on garbage', () => {
    expect(normalizeLens(undefined)).toBe('full')
    expect(normalizeLens(null)).toBe('full')
    expect(normalizeLens([])).toBe('full')
    expect(normalizeLens('FULL')).toBe('full')
    expect(normalizeLens(['subject', 'full'])).toBe('subject')
    expect(normalizeLens('bogus', 'none')).toBe('none')
  })
})

describe('effectiveLens — role framing', () => {
  it('admin sees full on a normal inbox', () => {
    expect(effectiveLens(vis({ isAdmin: true }), thread())).toBe('full')
  })

  it('admin sees full on a null-inbox thread', () => {
    expect(effectiveLens(vis({ isAdmin: true }), thread({ inboxId: null }))).toBe('full')
  })

  it("admin is capped at metadata on another user's personal inbox", () => {
    const v = vis({ isAdmin: true, personalInboxIds: { [PERSONAL]: true } })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL }))).toBe('metadata')
  })

  it('admin on a personal inbox is raised by an explicit grant', () => {
    const v = vis({
      isAdmin: true,
      personalInboxIds: { [PERSONAL]: true },
      threadGrants: { t1: 'subject' },
    })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL }))).toBe('subject')
  })

  it('owner of a personal inbox resolves to full via their Manager inbox floor', () => {
    const v = vis({
      isAdmin: true,
      personalInboxIds: { [PERSONAL]: true },
      inboxLens: { [PERSONAL]: 'full' },
    })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL }))).toBe('full')
  })

  it('admin assigned to a personal thread gets full', () => {
    const v = vis({ userId: 'u1', isAdmin: true, personalInboxIds: { [PERSONAL]: true } })
    expect(effectiveLens(v, thread({ inboxId: PERSONAL, assigneeId: 'u1' }))).toBe('full')
  })
})

describe('effectiveLens — non-admin derivations', () => {
  it('no access → none', () => {
    expect(effectiveLens(vis(), thread())).toBe('none')
  })

  it('assignment ⇒ full even on a none inbox', () => {
    const v = vis({ userId: 'u1' })
    expect(effectiveLens(v, thread({ inboxId: null, assigneeId: 'u1' }))).toBe('full')
  })

  it('a different assignee does not grant access', () => {
    expect(effectiveLens(vis({ userId: 'u1' }), thread({ assigneeId: 'u2' }))).toBe('none')
  })

  it.each(['metadata', 'subject', 'full'] as const)('inbox floor %s applies', (lens) => {
    expect(effectiveLens(vis({ inboxLens: { [INBOX]: lens } }), thread())).toBe(lens)
  })

  it('thread grant applies', () => {
    expect(effectiveLens(vis({ threadGrants: { t1: 'subject' } }), thread({ inboxId: null }))).toBe(
      'subject'
    )
  })

  it('entity grant applies to the primary entity', () => {
    const v = vis({ entityGrants: { deal_1: 'full' } })
    expect(effectiveLens(v, thread({ inboxId: null, primaryEntityInstanceId: 'deal_1' }))).toBe(
      'full'
    )
  })

  it('contact grant applies to a participant contact', () => {
    const v = vis({ contactGrants: { c1: 'metadata' } })
    expect(effectiveLens(v, thread({ inboxId: null, participantContactIds: ['c9', 'c1'] }))).toBe(
      'metadata'
    )
  })

  it('takes the max across inbox floor and a thread grant', () => {
    const v = vis({ inboxLens: { [INBOX]: 'metadata' }, threadGrants: { t1: 'full' } })
    expect(effectiveLens(v, thread())).toBe('full')
  })

  it('ignores type-level access — a contact not in contactGrants yields none', () => {
    // The context only ever carries instance-level grants; a "view all
    // contacts" type grant must never populate contactGrants (provider concern).
    const v = vis({ contactGrants: { c1: 'full' } })
    expect(effectiveLens(v, thread({ inboxId: null, participantContactIds: ['c2'] }))).toBe('none')
  })

  it('null inbox with no derivations → none', () => {
    expect(effectiveLens(vis(), thread({ inboxId: null }))).toBe('none')
  })
})

describe('effectiveLensBatch', () => {
  it('maps each thread to its lens', () => {
    const v = vis({ inboxLens: { [INBOX]: 'subject' } })
    const out = effectiveLensBatch(v, [
      thread({ threadId: 'a' }),
      thread({ threadId: 'b', inboxId: null }),
    ])
    expect(out.get('a')).toBe('subject')
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
    expect(automationLens(automation(), thread())).toBe('full')
    expect(automationLens(automation(), thread({ inboxId: null }))).toBe('full')
  })

  it('has zero access to personal inboxes — assignment does not raise it', () => {
    const a = automation([PERSONAL])
    expect(automationLens(a, thread({ inboxId: PERSONAL }))).toBe('none')
    expect(automationLens(a, thread({ inboxId: PERSONAL, assigneeId: 'u1' }))).toBe('none')
    expect(automationLens(a, thread())).toBe('full')
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
    expect(redactThreadMeta(META, 'full')).toBe(META)
  })

  it('subject keeps subject but blanks full-only fields', () => {
    const r = redactThreadMeta(META, 'subject')
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
    expect(redactThreadMeta(META, 'subject').participants).toEqual(['from:p1', 'to:p2'])
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
    const r = redactThreadPatch({ subject: 'x', isUnread: true } as any, 'subject')
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
    expect(redactMessage(MESSAGE, 'full')).toBe(MESSAGE)
  })

  it('subject (envelope tier) blanks content, keeps attachments an array', () => {
    const r = redactMessage(MESSAGE, 'subject')
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
    expect(redactMessagePatch(patch, 'full')).toBe(patch)
  })

  it('subject DROPS content keys (never blanks them onto the store)', () => {
    const r = redactMessagePatch(
      { snippet: 'preview', attachments: [{ id: 'a1' }], sendStatus: 'SENT' },
      'subject'
    )
    expect(r).toEqual({ sendStatus: 'SENT' })
    expect('snippet' in r).toBe(false)
    expect('attachments' in r).toBe(false)
  })
})

describe('inboxLensFor', () => {
  it('admin short-circuits to full on org inboxes', () => {
    expect(inboxLensFor(vis({ isAdmin: true }), INBOX)).toBe('full')
  })

  it("admin does NOT short-circuit on another user's personal inbox", () => {
    const v = vis({ isAdmin: true, personalInboxIds: { [PERSONAL]: true } })
    expect(inboxLensFor(v, PERSONAL)).toBe('none')
  })

  it('member reads the composed inbox floor, none when absent', () => {
    const v = vis({ inboxLens: { [INBOX]: 'subject' } })
    expect(inboxLensFor(v, INBOX)).toBe('subject')
    expect(inboxLensFor(v, 'other_inbox')).toBe('none')
  })
})
