// packages/lib/src/mail-suggestions/mine-conditions.test.ts
// The two halves of the miner that only mean anything against the REAL filter
// machinery: which condition a proposal actually prefills, and whether the
// grouped statement really excludes filter-touched threads.
//
// No module is replaced here — `mine.test.ts` stubs
// `assertFilterConditionsCompile` because a throwing gate is what it is testing;
// this file deliberately runs the genuine compiler, so a regression in the
// query builder's `list` / `senderDomain` support shows up as a failing
// preference rather than as a silently widened filter.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { buildInboxGroupQuery, type MailGroupStats, resolveProposedConditions } from './mine'

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

  it('treats an unknown DMARC verdict as unauthenticated (invariant 3)', () => {
    // `bool_and(... IS TRUE)` — a NULL column can never make the group pass.
    const { sql } = render(null)
    expect(sql).toContain('bool_and(m."senderAuthenticated" IS TRUE)')
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
})
