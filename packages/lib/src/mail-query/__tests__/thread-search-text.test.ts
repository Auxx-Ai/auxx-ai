// packages/lib/src/mail-query/__tests__/thread-search-text.test.ts
//
// The `Thread.searchText` corpus expression. This one is worth asserting on
// rendered text because it IS text — a raw SQL string, spliced verbatim into
// two thread-metadata recomputes, one chat write and one backfill. If those
// four ever disagree about the corpus, a thread is searchable or not depending
// on which code path last touched it, and nothing fails loudly.

import { describe, expect, it } from 'vitest'
import {
  THREAD_SEARCH_MAX_MESSAGES,
  THREAD_SEARCH_MESSAGE_LIMIT,
  THREAD_SEARCH_TOTAL_LIMIT,
  threadSearchTextAssignmentSql,
  threadSearchTextExpressionSql,
} from '../thread-search-text'

describe('threadSearchTextExpressionSql — bounds', () => {
  it('applies all three bounds, so `to_tsvector` can never be handed >1 MB', () => {
    // `to_tsvector` does not degrade past 1 MB of input — it raises
    // "string is too long for tsvector", which would fail the WRITE (an inbound
    // email that cannot be stored), not the search. Every one of these is what
    // keeps the column short enough for that to be impossible.
    const expression = threadSearchTextExpressionSql('t')

    expect(expression).toContain(`LIMIT ${THREAD_SEARCH_MAX_MESSAGES}`)
    expect(expression).toMatch(
      new RegExp(String.raw`,\s*${THREAD_SEARCH_MESSAGE_LIMIT}\s*\)\s*AS txt`)
    )
    expect(expression).toContain(`), ''), ${THREAD_SEARCH_TOTAL_LIMIT})`)
  })

  it('keeps the total bound far enough under the tsvector ceiling to survive UTF-8', () => {
    // The ceiling is 1 MB of BYTES. At the 4-bytes-per-character worst case the
    // cap must still leave headroom, or a mailbox of CJK text reintroduces the
    // write failure this bound exists to prevent.
    expect(THREAD_SEARCH_TOTAL_LIMIT * 4).toBeLessThan(1024 * 1024)
  })

  it('cannot exceed the total cap even at the per-message maximum', () => {
    // Belt and braces: the outer LEFT() is the real guarantee, but a per-message
    // limit × message count that dwarfs it means the outer clip does all the
    // work and the ordering (newest first) stops meaning anything.
    expect(THREAD_SEARCH_MESSAGE_LIMIT).toBeLessThanOrEqual(THREAD_SEARCH_TOTAL_LIMIT)
  })
})

describe('threadSearchTextExpressionSql — corpus shape', () => {
  it('correlates to the alias it was given, not to a hard-coded one', () => {
    // A `PgColumn` in a correlated subquery loses its table qualifier when
    // Drizzle flattens a single-table projection, which is why this is a raw
    // string — and why the alias has to be a parameter rather than baked in.
    expect(threadSearchTextExpressionSql('t')).toContain('m."threadId" = t.id')
    expect(threadSearchTextExpressionSql('thr')).toContain('m."threadId" = thr.id')
    expect(threadSearchTextExpressionSql('thr')).not.toContain('= t.id')
  })

  it('prefers textPlain but falls back to de-tagged textHtml', () => {
    // 4.8% of dev messages are HTML-only. Dropping the fallback loses them
    // entirely; keeping the HTML raw turns `div`, `td` and every attribute name
    // into lexemes.
    const expression = threadSearchTextExpressionSql()

    expect(expression).toContain(`NULLIF(m."textPlain", '')`)
    expect(expression).toContain(`regexp_replace(COALESCE(m."textHtml", ''), '<[^>]*>', ' ', 'g')`)
  })

  it('collapses whitespace so a quoted reply block does not spend the budget on newlines', () => {
    expect(threadSearchTextExpressionSql()).toContain(`'\\s+', ' ', 'g'`)
  })

  it('orders newest-first, so truncation drops the oldest quoted material', () => {
    // Both orderings are load-bearing: the inner ORDER BY + LIMIT chooses WHICH
    // messages, the string_agg ORDER BY chooses the order they are concatenated
    // in — and it is the concatenation order that decides what the outer LEFT()
    // clips off.
    const expression = threadSearchTextExpressionSql()

    expect(expression).toContain(`ORDER BY m."sentAt" DESC NULLS LAST, m.id DESC`)
    expect(expression).toContain(`string_agg(x.txt, ' ' ORDER BY x.rn)`)
  })

  it('yields NULL rather than an empty string for a thread with no body text', () => {
    // An empty-string corpus and a NULL corpus index identically (the GIN
    // expression COALESCEs), but NULL is what the backfill's
    // `IS DISTINCT FROM` guard compares against, so a bodyless thread must
    // settle on one value or every re-run rewrites it.
    expect(threadSearchTextExpressionSql()).toContain(`NULLIF(TRIM(`)
    expect(threadSearchTextExpressionSql()).toContain(`), ''), ${THREAD_SEARCH_TOTAL_LIMIT})`)
  })

  it('excludes the subject — the mail lens scopes subject and body separately', () => {
    // 🔴 The permissions-relevant assertion. `Thread.subject` is matched under
    // the `identity` tier and this corpus under `read`; folding the subject in
    // here would let a subject-only viewer match on body text.
    expect(threadSearchTextExpressionSql()).not.toContain('subject')
  })
})

describe('threadSearchTextAssignmentSql', () => {
  it('is the same expression, as a SET clause', () => {
    // The two thread-metadata recomputes splice this into an UPDATE that is
    // already running; sharing the expression is what stops the corpus from
    // depending on which write path last ran.
    expect(threadSearchTextAssignmentSql('t')).toBe(
      `"searchText" = ${threadSearchTextExpressionSql('t')}`
    )
  })
})
