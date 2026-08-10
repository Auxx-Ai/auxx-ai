// packages/lib/src/mail-suggestions/mine-conditions.test.ts
// The parts of the miner that only mean anything against the REAL filter
// machinery and the REAL emitted statement: which condition a proposal actually
// prefills, whether the grouped query excludes filter-touched threads, which
// CLOCK it windows on (04-v2-plan §1.2, V2), and how it reads
// `senderAuthenticated` (04-v2-plan §2.3, V3).
//
// No module is replaced here — `mine.test.ts` stubs
// `assertFilterConditionsCompile` because a throwing gate is what it is testing;
// this file deliberately runs the genuine compiler, so a regression in the
// query builder's `list` / `senderDomain` support shows up as a failing
// preference rather than as a silently widened filter.
//
// Vitest has no Postgres, so the V2/V3 blocks use the same two-layer shape as
// `mail-query/__tests__/thread-search-sql.test.ts`: rendered-SQL tests pin the
// expression the database receives, and small TypeScript MODELS of those
// expressions prove the behaviour that follows from them — each model asserted
// against the rendered SQL so it cannot outlive a change to the source.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  buildInboxGroupQuery,
  buildMailSuggestionDrafts,
  type MailGroupStats,
  resolveProposedConditions,
  toMailGroupStats,
} from './mine'

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
    unsubscribeMeta: null,
    firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-08-01T00:00:00.000Z'),
    sampleThreadIds: [],
    topTagId: null,
    topTagThreadCount: 0,
    topAssigneeId: null,
    topAssigneeThreadCount: 0,
    ...overrides,
  }
}

describe('resolveProposedConditions', () => {
  it('prefers `list is <listId>` — the identity that survives VERP', () => {
    const conditions = resolveProposedConditions(group(), 'org_1')
    expect(conditions?.[0]?.conditions[0]).toMatchObject({
      fieldId: 'list',
      operator: 'is',
      value: 'news.acme.com',
    })
  })

  it('falls back to the sender domain when there is no list id', () => {
    const conditions = resolveProposedConditions(
      group({ listId: null, subjectKey: 'domain:acme.com' }),
      'org_1'
    )
    expect(conditions?.[0]?.conditions[0]).toMatchObject({
      fieldId: 'senderDomain',
      operator: 'is',
      value: 'acme.com',
    })
  })

  it('returns null — never an empty condition set — when nothing can be proposed', () => {
    // An empty ConditionGroup[] would compile to the BARE ORG SCOPE, i.e. a
    // filter matching every thread in the inbox (mail-filters invariant 19).
    // `null` is what makes the caller skip the suggestion instead.
    expect(
      resolveProposedConditions(group({ listId: null, senderDomain: null }), 'org_1')
    ).toBeNull()
  })

  it('narrows a DOMAIN proposal with `list is empty` so it matches only its own group', () => {
    // A domain group is `listId IS NULL AND senderDomain = d` — that is what
    // `COALESCE('list:' || listId, 'domain:' || senderDomain)` means. A bare
    // `senderDomain is d` filter would ALSO sweep that domain's list-bearing mail,
    // which belongs to its own separate group whose unread rate and `everReplied`
    // never reached this card. Narrowing, not widening, is the safe direction.
    const conditions = resolveProposedConditions(
      group({ listId: null, subjectKey: 'domain:acme.com' }),
      'org_1'
    )
    expect(conditions?.[0]?.conditions).toHaveLength(2)
    expect(conditions?.[0]?.conditions[1]).toMatchObject({ fieldId: 'list', operator: 'empty' })
  })

  it('leaves a LIST proposal at one condition — the list id is already the group', () => {
    const conditions = resolveProposedConditions(group(), 'org_1')
    expect(conditions).toHaveLength(1)
    expect(conditions?.[0]?.logicalOperator).toBe('AND')
    expect(conditions?.[0]?.conditions).toHaveLength(1)
  })
})

describe('buildInboxGroupQuery', () => {
  const render = (readerUserId: string | null) =>
    new PgDialect().sqlToQuery(
      buildInboxGroupQuery({
        organizationId: 'org_1',
        inboxId: 'ibx_1',
        readerUserId,
        since: new Date('2026-05-03T00:00:00.000Z'),
      })
    )

  it('excludes threads a MailFilter already fired on from the manual-archive count', () => {
    const { sql } = render(null)
    expect(sql).toContain('"MailFilterRun"')
    expect(sql).toContain('WHERE archived AND NOT filtered')
  })

  it('collapses to one row per thread before any rate is taken', () => {
    const { sql } = render(null)
    // The per-thread CTE is what stops a 12-message newsletter thread counting
    // twelve times toward threadCount / unreadRate / manualArchiveRate.
    expect(sql).toContain('WITH per_thread AS')
    expect(sql).toContain('count(*)::int AS thread_count')
  })

  it('reads a SHARED inbox as "no member has read it"', () => {
    const { sql, params } = render(null)
    expect(sql).toContain('"ThreadReadStatus"')
    expect(sql).not.toContain('rs."userId"')
    expect(params).not.toContain('usr_owner')
  })

  it('reads a PERSONAL inbox against its owner alone', () => {
    const { sql, params } = render('usr_owner')
    expect(sql).toContain('rs."userId"')
    expect(params).toContain('usr_owner')
  })

  it('counts only inbound mail, inside the window, on unmerged threads', () => {
    const { sql, params } = render(null)
    expect(sql).toContain('m."isInbound" = true')
    expect(sql).toContain('t."mergedIntoThreadId" IS NULL')
    expect(params).toContainEqual(new Date('2026-05-03T00:00:00.000Z'))
  })

  it('groups on the list-then-domain keyspace, never on a fused key (S7)', () => {
    const { sql } = render(null)
    expect(sql).toContain(`COALESCE('list:' || m."listId", 'domain:' || m."senderDomain")`)
  })

  // ── V2: mail time, not ingest time (04-v2-plan §1.2) ───────────────────────
  //
  // Vitest has no Postgres, so what is pinned here is the EXPRESSION the
  // database receives; `MESSAGE_AT semantics` below models what Postgres then
  // does with it, and asserts the model against this same rendered SQL so the
  // two cannot drift apart. Together they cover the two cases that matter: a
  // NULL `receivedAt` still counts (the fallback survives), and an old message
  // re-ingested today does NOT (the backfill stops masquerading as recent).
  //
  // The second case is LATENT today — every ingest path currently sets
  // `createdAt` from the provider's message time, so the two columns agree on
  // every row in dev. That is exactly why it wants a test: the property is held
  // by five unrelated call sites agreeing, not by anything enforced.
  describe('windows on mail time, not ingest time (V2)', () => {
    it('binds the 90-day window to COALESCE(receivedAt, createdAt)', () => {
      const { sql } = render(null)
      expect(sql).toContain('AND COALESCE(m."receivedAt", m."createdAt") >= ')
    })

    it('takes first_at / last_at off the same clock, so historyDays is mail time', () => {
      const { sql } = render(null)
      // `historyDays` and the "N emails in 90 days" copy are computed from these
      // two. On an ingest-time clock a freshly connected mailbox would report
      // its whole backfill as 90 days of traffic.
      expect(sql).toContain('min(COALESCE(m."receivedAt", m."createdAt")) AS first_at')
      expect(sql).toContain('max(COALESCE(m."receivedAt", m."createdAt")) AS last_at')
    })

    it('orders "newest message" picks on the same clock', () => {
      const { sql } = render(null)
      // Both the unsubscribe header and the DMARC verdict are "newest wins"
      // reads. Ordering them on ingest time would hand back whichever message
      // we happened to sync last.
      const orderings = sql.match(/ORDER BY COALESCE\(m\."receivedAt", m\."createdAt"\) DESC/g)
      expect(orderings).toHaveLength(2)
    })

    it('leaves no bare m."createdAt" anywhere in the statement', () => {
      // The real regression guard: one un-coalesced reference re-opens V2 for
      // whichever number it feeds.
      const { sql } = render(null)
      expect(sql.replace(/COALESCE\(m\."receivedAt", m\."createdAt"\)/g, '')).not.toContain(
        'm."createdAt"'
      )
    })

    it('never windows on receivedAt alone — the fallback is what keeps NULLs in', () => {
      // `receivedAt` is nullable (Outlook/IMAP history). Dropping the coalesce
      // for a bare `receivedAt >= since` would silently exclude every message
      // that has no mail-time at all, which is the opposite failure.
      const { sql } = render(null)
      expect(sql).not.toMatch(/m\."receivedAt"(?!, m\."createdAt")/)
    })
  })

  describe('MESSAGE_AT semantics — what Postgres does with that expression', () => {
    const SINCE = new Date('2026-05-03T00:00:00.000Z')

    /**
     * COALESCE, in TypeScript. Tied to the source by the assertion below, which
     * re-reads the rendered SQL: if the expression stops being a coalesce of
     * those two columns in that order, this model stops being a model.
     */
    const messageAt = (m: { receivedAt: Date | null; createdAt: Date }): Date =>
      m.receivedAt ?? m.createdAt
    const inWindow = (m: { receivedAt: Date | null; createdAt: Date }) => messageAt(m) >= SINCE

    it('models the expression the statement actually emits', () => {
      expect(render(null).sql).toContain('COALESCE(m."receivedAt", m."createdAt")')
    })

    it('still counts a message with no receivedAt — the fallback holds', () => {
      expect(inWindow({ receivedAt: null, createdAt: new Date('2026-06-01T00:00:00.000Z') })).toBe(
        true
      )
    })

    it('drops a two-year-old message backfilled into the org today (the V2 bug)', () => {
      // The exact shape of a freshly connected mailbox: ingested minutes ago,
      // received in 2024. On an ingest-time clock this clears the window and
      // inflates `messageCount` / `historyDays` under a card claiming
      // "in 90 days".
      expect(
        inWindow({
          receivedAt: new Date('2024-03-01T00:00:00.000Z'),
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        })
      ).toBe(false)
    })

    it('keeps genuinely recent mail regardless of when it was ingested', () => {
      expect(
        inWindow({
          receivedAt: new Date('2026-07-30T00:00:00.000Z'),
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        })
      ).toBe(true)
    })
  })

  // ── V3: the newest message's verdict, matching the executor ────────────────
  describe('senderAuthenticated is the newest message (V3, invariant 3)', () => {
    it('picks the newest message per thread, not bool_and over the window', () => {
      const { sql } = render(null)
      // `bool_and` disagreed with `resolveUnsubscribeTarget`, which reads the
      // gate inputs off the newest inbound message: one stale unauthenticated
      // message made the card refuse while the button would have offered.
      expect(sql).not.toContain('bool_and(m."senderAuthenticated" IS TRUE)')
      expect(sql).toContain(
        'array_agg(m."senderAuthenticated" ORDER BY COALESCE(m."receivedAt", m."createdAt") DESC)'
      )
    })

    it('rolls the group up to the thread holding the newest message', () => {
      const { sql } = render(null)
      expect(sql).not.toContain('bool_and(sender_authenticated)')
      expect(sql).toContain('array_agg(sender_authenticated ORDER BY last_at DESC)')
    })

    it('collapses a NULL verdict to false at BOTH levels (invariant 3 does not move)', () => {
      // An array subscript over a NULL element yields NULL, and `IS TRUE` is the
      // only thing standing between that and an unsubscribe offered to an
      // unverified sender. Two aggregations, two guards.
      const { sql } = render(null)
      const guards = sql.match(/\)\[1\] IS TRUE\)/g)
      expect(guards).toHaveLength(2)
    })
  })

  describe('newest-message semantics, end to end into the card', () => {
    /**
     * `(array_agg(verdict ORDER BY at DESC))[1] IS TRUE`, in TypeScript — the
     * same modelling contract as `MESSAGE_AT semantics` above, and the same
     * reading `resolveUnsubscribeTarget` gets from `ORDER BY receivedAt DESC
     * LIMIT 1`.
     */
    const newestVerdict = (messages: { at: string; verdict: boolean | null }[]): boolean =>
      [...messages].sort((a, b) => b.at.localeCompare(a.at))[0]?.verdict === true

    /** A DOMAIN group: no `listId`, so the gate rests on the verdict alone. */
    const cardKindFor = (messages: { at: string; verdict: boolean | null }[]) =>
      buildMailSuggestionDrafts({
        organizationId: 'org_1',
        inboxId: 'ibx_1',
        userId: null,
        groups: [
          group({
            subjectKey: 'domain:intuit.com',
            listId: null,
            senderDomain: 'intuit.com',
            unsubscribeMeta: { httpUrl: 'https://intuit.com/u', oneClick: true },
            senderAuthenticated: newestVerdict(messages),
          }),
        ],
        suppressedSubjectKeys: new Set<string>(),
      }).map((d) => d.kind)

    it('does not let one stale unauthenticated message poison the group', () => {
      // `domain:intuit.com` — the case where the old `bool_and` made the card
      // say "unverified sender, archive instead" while the executor, reading the
      // newest message, would have offered one-click.
      expect(
        cardKindFor([
          { at: '2026-05-10', verdict: false },
          { at: '2026-06-02', verdict: null },
          { at: '2026-07-28', verdict: true },
        ])
      ).toEqual(['unsubscribe'])
    })

    it('refuses when the NEWEST message has no verdict, however clean the history', () => {
      // Invariant 3 at the boundary the change actually moved: unknown on the
      // newest message is NOT authenticated, even behind a wall of passes.
      expect(
        cardKindFor([
          { at: '2026-05-10', verdict: true },
          { at: '2026-06-02', verdict: true },
          { at: '2026-07-28', verdict: null },
        ])
      ).toEqual(['auto-archive'])
    })

    it('refuses when the newest message failed, after older ones passed', () => {
      expect(
        cardKindFor([
          { at: '2026-05-10', verdict: true },
          { at: '2026-07-28', verdict: false },
        ])
      ).toEqual(['auto-archive'])
    })
  })
})

describe('MailGroupStats.senderAuthenticated — NULL is never a pass', () => {
  it('reads a raw NULL verdict as false, whatever the aggregation emitted', () => {
    // `toMailGroupStats` is the last line of defence: the column is
    // `boolean | null` in the database and `boolean` in the type, and only
    // `=== true` may produce the pass.
    expect(toMailGroupStats({ subject_key: 'domain:x.com' }).senderAuthenticated).toBe(false)
    expect(
      toMailGroupStats({ subject_key: 'domain:x.com', sender_authenticated: null })
        .senderAuthenticated
    ).toBe(false)
    expect(
      toMailGroupStats({ subject_key: 'domain:x.com', sender_authenticated: true })
        .senderAuthenticated
    ).toBe(true)
  })

  it('carries first/last seen through as the mail-time bounds of the group', () => {
    const stats = toMailGroupStats({
      subject_key: 'list:news.acme.com',
      first_seen_at: '2026-05-04T00:00:00.000Z',
      last_seen_at: '2026-07-30T00:00:00.000Z',
    })
    expect(stats.firstSeenAt).toEqual(new Date('2026-05-04T00:00:00.000Z'))
    expect(stats.lastSeenAt).toEqual(new Date('2026-07-30T00:00:00.000Z'))
  })
})
