// packages/lib/src/mail-suggestions/mine.test.ts
// The decision layer (§5.2 / §5.3): every threshold boundary, all four
// suppression rules, the 5-per-inbox cap and its ranking, and the unsubscribe
// safety gate.
//
// `buildMailSuggestionDrafts` is pure, so none of this needs a database — the
// shared `src/test/setup.ts` `@auxx/database` proxy stays in place, per the
// lib-test rule about never fully replacing a shared mock.
//
// `../mail-filters/evaluate` IS replaced, deliberately and only here: this file
// is about what the miner decides, and the one function it borrows from there
// (`assertFilterConditionsCompile`) is a gate whose THROWING is the behaviour
// under test. `mine-conditions.test.ts` exercises the real compiler.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ assertCompile: vi.fn() }))
vi.mock('../mail-filters/evaluate', () => ({
  assertFilterConditionsCompile: h.assertCompile,
}))

import {
  ALREADY_FILTERED_RATE,
  buildMailSuggestionDrafts,
  historyDaysOf,
  MAX_SUGGESTIONS_PER_INBOX,
  type MailGroupStats,
} from './mine'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-08-01T00:00:00.000Z')

function group(overrides: Partial<MailGroupStats> = {}): MailGroupStats {
  return {
    subjectKey: 'list:news.acme.com',
    listId: 'news.acme.com',
    senderDomain: 'acme.com',
    messageCount: 20,
    threadCount: 10,
    readThreadCount: 0,
    manualArchivedThreadCount: 0,
    filteredThreadCount: 0,
    everReplied: false,
    senderAuthenticated: true,
    unsubscribeMeta: { httpUrl: 'https://acme.com/u', oneClick: true },
    firstSeenAt: new Date(NOW.getTime() - 60 * DAY),
    lastSeenAt: NOW,
    sampleThreadIds: ['thr_1', 'thr_2'],
    topTagId: null,
    topTagThreadCount: 0,
    topAssigneeId: null,
    topAssigneeThreadCount: 0,
    ...overrides,
  }
}

function build(groups: MailGroupStats[], suppressed: string[] = []) {
  return buildMailSuggestionDrafts({
    organizationId: 'org_1',
    inboxId: 'ibx_1',
    userId: null,
    groups,
    suppressedSubjectKeys: new Set(suppressed),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.assertCompile.mockImplementation(() => undefined)
})

describe('volume + history thresholds (§5.2)', () => {
  it('produces a card at exactly the floors', () => {
    const drafts = build([
      group({
        messageCount: 5,
        threadCount: 3,
        firstSeenAt: new Date(NOW.getTime() - 14 * DAY),
        lastSeenAt: NOW,
      }),
    ])
    expect(drafts).toHaveLength(1)
  })

  it('produces nothing one message below the floor', () => {
    expect(build([group({ messageCount: 4 })])).toEqual([])
  })

  it('produces nothing one thread below the floor', () => {
    expect(build([group({ threadCount: 2, messageCount: 20 })])).toEqual([])
  })

  it('produces nothing just under 14 days of history', () => {
    const drafts = build([
      group({
        firstSeenAt: new Date(NOW.getTime() - 14 * DAY + 60_000),
        lastSeenAt: NOW,
      }),
    ])
    expect(drafts).toEqual([])
  })

  it('historyDaysOf reads 0 when a group has no timestamps', () => {
    expect(historyDaysOf(group({ firstSeenAt: null, lastSeenAt: null }))).toBe(0)
  })
})

describe('unread + archive rate thresholds (§5.2)', () => {
  it('proposes unsubscribe at exactly unreadRate 0.8', () => {
    const drafts = build([group({ threadCount: 10, readThreadCount: 2 })])
    expect(drafts.map((d) => d.kind)).toEqual(['unsubscribe'])
    expect(drafts[0]?.evidence.unreadRate).toBeCloseTo(0.8)
  })

  it('proposes nothing just under unreadRate 0.8 with no other signal', () => {
    expect(build([group({ threadCount: 10, readThreadCount: 3 })])).toEqual([])
  })

  it('proposes auto-archive at exactly manualArchiveRate 0.8', () => {
    const drafts = build([
      group({ threadCount: 10, readThreadCount: 10, manualArchivedThreadCount: 8 }),
    ])
    expect(drafts.map((d) => d.kind)).toEqual(['auto-archive'])
  })

  it('proposes nothing just under manualArchiveRate 0.8', () => {
    expect(
      build([group({ threadCount: 10, readThreadCount: 10, manualArchivedThreadCount: 7 })])
    ).toEqual([])
  })

  it('proposes auto-tag at exactly consistency 0.8, and not below', () => {
    const at = build([
      group({ threadCount: 10, readThreadCount: 10, topTagId: 'tag_1', topTagThreadCount: 8 }),
    ])
    expect(at.map((d) => d.kind)).toEqual(['auto-tag'])
    expect(at[0]?.evidence.consistency).toBeCloseTo(0.8)
    expect(at[0]?.proposedActions).toEqual([{ type: 'add-tag', tagIds: ['tag_1'] }])

    const below = build([
      group({ threadCount: 10, readThreadCount: 10, topTagId: 'tag_1', topTagThreadCount: 7 }),
    ])
    expect(below).toEqual([])
  })

  it('proposes auto-assign at exactly consistency 0.8, and not below', () => {
    const at = build([
      group({
        threadCount: 10,
        readThreadCount: 10,
        topAssigneeId: 'usr_1',
        topAssigneeThreadCount: 8,
      }),
    ])
    expect(at.map((d) => d.kind)).toEqual(['auto-assign'])
    expect(at[0]?.proposedActions).toEqual([{ type: 'assign', assigneeId: 'usr_1' }])

    const below = build([
      group({
        threadCount: 10,
        readThreadCount: 10,
        topAssigneeId: 'usr_1',
        topAssigneeThreadCount: 7,
      }),
    ])
    expect(below).toEqual([])
  })
})

describe('suppression rule 1 — one reply ever, forever (invariant 5)', () => {
  it('produces nothing for a subjectKey a human has replied to, however loud the evidence', () => {
    const drafts = build([
      group({
        everReplied: true,
        messageCount: 500,
        threadCount: 200,
        readThreadCount: 0,
        manualArchivedThreadCount: 200,
      }),
    ])
    expect(drafts).toEqual([])
  })

  it('never writes everReplied: true into evidence — such a group never becomes a card', () => {
    const drafts = build([group(), group({ subjectKey: 'domain:b.com', everReplied: true })])
    expect(drafts.every((d) => d.evidence.everReplied === false)).toBe(true)
  })
})

describe('suppression rule 2 — already covered by a filter (invariant 6)', () => {
  it('produces nothing once half the threads carry a MailFilterRun', () => {
    const drafts = build([group({ threadCount: 10, filteredThreadCount: 5 })])
    expect(ALREADY_FILTERED_RATE).toBe(0.5)
    expect(drafts).toEqual([])
  })

  it('still produces below the coverage rate, and records the count as evidence', () => {
    const drafts = build([group({ threadCount: 10, filteredThreadCount: 4 })])
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.evidence.filteredThreadCount).toBe(4)
  })

  it('excludes filter-touched threads from manualArchiveRate', () => {
    // 10 threads: 4 archived by a filter (not counted), 4 archived by hand.
    const drafts = build([
      group({
        threadCount: 10,
        readThreadCount: 10,
        filteredThreadCount: 4,
        manualArchivedThreadCount: 4,
      }),
    ])
    // 4/10 = 0.4, under the 0.8 archive threshold — no card, which is the point:
    // a filter is already doing the archiving.
    expect(drafts).toEqual([])
  })
})

describe('suppression rule 3 — dismissal is permanent (invariant 7)', () => {
  it('never re-proposes a dismissed subjectKey', () => {
    expect(build([group()], ['list:news.acme.com'])).toEqual([])
  })

  it('suppresses only the dismissed key, not the whole inbox', () => {
    const drafts = build(
      [group(), group({ subjectKey: 'domain:other.com', listId: null, senderDomain: 'other.com' })],
      ['list:news.acme.com']
    )
    expect(drafts.map((d) => d.subjectKey)).toEqual(['domain:other.com'])
  })
})

describe('suppression rule 4 — five per inbox, ranked (invariant 12)', () => {
  it('caps at five and keeps the loudest by messageCount × unreadRate', () => {
    const groups = [10, 20, 30, 40, 50, 60, 70, 80].map((n) =>
      group({
        subjectKey: `domain:s${n}.com`,
        listId: null,
        senderDomain: `s${n}.com`,
        messageCount: n,
      })
    )
    const drafts = build(groups)
    expect(drafts).toHaveLength(MAX_SUGGESTIONS_PER_INBOX)
    expect(drafts.map((d) => d.subjectKey)).toEqual([
      'domain:s80.com',
      'domain:s70.com',
      'domain:s60.com',
      'domain:s50.com',
      'domain:s40.com',
    ])
  })

  it('ranks on messageCount × unreadRate, not on messageCount alone', () => {
    const loudButRead = group({
      subjectKey: 'domain:loud.com',
      listId: null,
      senderDomain: 'loud.com',
      messageCount: 100,
      threadCount: 10,
      readThreadCount: 10,
      manualArchivedThreadCount: 10, // qualifies via the archive branch
    })
    const quietButUnread = group({
      subjectKey: 'domain:quiet.com',
      listId: null,
      senderDomain: 'quiet.com',
      messageCount: 30,
      threadCount: 10,
      readThreadCount: 0,
    })
    const drafts = build([loudButRead, quietButUnread])
    // 100 × 0 = 0 vs 30 × 1 = 30.
    expect(drafts.map((d) => d.subjectKey)).toEqual(['domain:quiet.com', 'domain:loud.com'])
  })

  it('produces a stable order across reruns over unchanged data', () => {
    const groups = [1, 2, 3].map((n) =>
      group({ subjectKey: `domain:s${n}.com`, listId: null, senderDomain: `s${n}.com` })
    )
    expect(build(groups).map((d) => d.subjectKey)).toEqual(
      build([...groups].reverse()).map((d) => d.subjectKey)
    )
  })
})

describe('the unsubscribe safety gate (§6.2, invariants 3/4)', () => {
  const domainGroup = (overrides: Partial<MailGroupStats>) =>
    group({
      subjectKey: 'domain:acme.com',
      listId: null,
      senderDomain: 'acme.com',
      ...overrides,
    })

  it('offers unsubscribe for a real mailing list even when unauthenticated', () => {
    const drafts = build([group({ senderAuthenticated: false })])
    expect(drafts.map((d) => d.kind)).toEqual(['unsubscribe'])
  })

  it('offers unsubscribe for an authenticated sender with no list id', () => {
    const drafts = build([domainGroup({ senderAuthenticated: true })])
    expect(drafts.map((d) => d.kind)).toEqual(['unsubscribe'])
  })

  it('offers ARCHIVE, never unsubscribe, with no list id and no authentication', () => {
    const drafts = build([domainGroup({ senderAuthenticated: false })])
    expect(drafts.map((d) => d.kind)).toEqual(['auto-archive'])
  })

  it('treats an unknown DMARC verdict exactly like a failed one', () => {
    // `senderAuthenticated` is NULL on the row for Outlook/IMAP history; the SQL
    // collapses it to false, and false must not be coerced back to a pass.
    const drafts = build([domainGroup({ senderAuthenticated: false })])
    expect(drafts[0]?.kind).toBe('auto-archive')
    expect(drafts[0]?.evidence.senderAuthenticated).toBe(false)
  })

  it('offers archive when the sender published no usable unsubscribe header', () => {
    const drafts = build([group({ unsubscribeMeta: null })])
    expect(drafts.map((d) => d.kind)).toEqual(['auto-archive'])
    expect(drafts[0]?.evidence.unsubscribeMethod).toBeNull()
  })

  it('records the tier the headers actually support', () => {
    expect(
      build([group({ unsubscribeMeta: { httpUrl: 'https://x' } })])[0]?.evidence.unsubscribeMethod
    ).toBe('http')
    expect(
      build([group({ unsubscribeMeta: { mailto: 'mailto:u@x' } })])[0]?.evidence.unsubscribeMethod
    ).toBe('mailto')
    expect(build([group()])[0]?.evidence.unsubscribeMethod).toBe('one-click')
  })

  it('pairs every unsubscribe with an archive filter (S10)', () => {
    expect(build([group()])[0]?.proposedActions).toEqual([
      { type: 'suppress-automations' },
      { type: 'set-status', status: 'ARCHIVED' },
    ])
  })
})

describe('proposedConditions must compile before the row is written', () => {
  it('skips the whole group when no candidate condition compiles', () => {
    h.assertCompile.mockImplementation(() => {
      throw new Error('“Mailing list” is not a field mail filters can match on')
    })
    expect(build([group()])).toEqual([])
  })

  it('skips only the uncompilable group, not its neighbours', () => {
    h.assertCompile.mockImplementation((conditions: unknown) => {
      const value = (conditions as { conditions: { value: string }[] }[])[0]?.conditions[0]?.value
      if (String(value).includes('acme')) throw new Error('nope')
    })
    const drafts = build([
      group(),
      group({ subjectKey: 'domain:other.com', listId: null, senderDomain: 'other.com' }),
    ])
    expect(drafts.map((d) => d.subjectKey)).toEqual(['domain:other.com'])
  })

  it('validates BEFORE any row would be written — once per candidate, never lazily', () => {
    build([group()])
    expect(h.assertCompile).toHaveBeenCalled()
  })
})

describe('evidence', () => {
  it('carries everything the card renders, so display never re-queries', () => {
    const [draft] = build([group({ threadCount: 10, readThreadCount: 2 })])
    expect(draft?.evidence).toMatchObject({
      windowDays: 90,
      messageCount: 20,
      threadCount: 10,
      unreadRate: 0.8,
      manualArchiveRate: 0,
      everReplied: false,
      sampleThreadIds: ['thr_1', 'thr_2'],
      unsubscribeMethod: 'one-click',
      listId: 'news.acme.com',
      senderDomain: 'acme.com',
      senderAuthenticated: true,
      historyDays: 60,
    })
  })
})
