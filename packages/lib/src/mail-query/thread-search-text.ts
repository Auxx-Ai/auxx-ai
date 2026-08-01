// packages/lib/src/mail-query/thread-search-text.ts
//
// `Thread.searchText` — the corpus behind ranked mail free-text search.
//
// This module is the SINGLE definition of that corpus. The two thread-metadata
// recomputes (`ingest/threads/update-metadata.ts`,
// `messages/thread-manager.service.ts`), the chat-channel message write
// (`providers/chat/chat-provider.ts`) and the one-time backfill
// (`data-migrations/migrations/069-backfill-thread-search-text.ts`) all compose
// {@link threadSearchTextExpressionSql} rather than restating it — a corpus that
// two writers disagree about is worse than no corpus, because the disagreement
// is invisible until someone can't find a thread they can see.
//
// 🔴 **Subject is deliberately NOT part of this corpus.** The mail lens grants
// subject visibility (`identity`) and body visibility (`read`) as separate
// tiers (`visibility-scope.ts`, mail-permissions §5.3). `Thread.subject` keeps
// its own indexed arm under `scopes.subject`; this column carries message bodies
// only, under `scopes.body`. Blending them into one column would let a viewer
// who may read only the subject match on body text — a permissions bug written
// as a denormalization.

import type { Database, Transaction } from '@auxx/database'
import { sql } from 'drizzle-orm'

// =============================================================================
// BOUNDS
// =============================================================================
//
// Measured on the dev DB (2026-07-31): 6,526 threads / 8,133 messages,
// 1.25 messages per thread (p99 5, max 14); `textPlain` averages 1,919 chars
// (p50 949, p90 4,236, p99 16,385, max 89,936). Whole-thread raw body text
// averages 2,391 chars, p90 4,915, p99 21,100, max 365,184.

/**
 * Max characters kept from a single message body.
 *
 * p99 of `textPlain` is 16,385 chars and the observed maximum is 89,936, so this
 * keeps the whole body for ~99% of messages. The clipped tail in email is
 * overwhelmingly quoted reply chains and legal footers — lexemes already present
 * earlier in the same thread.
 */
export const THREAD_SEARCH_MESSAGE_LIMIT = 20000

/**
 * Max messages folded into one thread's corpus, newest first.
 *
 * p99 of messages-per-thread is 5 and the maximum in dev is 14; 50 is well past
 * the observed ceiling and bounds the pathological case (an automated
 * notification thread that accretes hundreds of messages) without touching real
 * conversations. It is a backstop, not a tuning knob — the total cap below is
 * what actually binds.
 */
export const THREAD_SEARCH_MAX_MESSAGES = 50

/**
 * Hard cap on the whole column.
 *
 * **This is the bound that matters.** `to_tsvector` does not degrade past 1 MB
 * of input — it raises `string is too long for tsvector`, which would make the
 * GIN index fail the *write* (an inbound email that cannot be stored), not the
 * search. 40,000 characters is 26× under that ceiling; the ceiling is in *bytes*,
 * so even at the 4-bytes-per-character worst case this is still 6× under.
 *
 * Measured on the dev org (6,526 threads), recall against the *unbounded*
 * corpus over eight representative support terms (2,978 matching threads):
 *
 * | Total cap | Recall | Corpus avg | GIN index | At cap | `order refund` query |
 * |---|---|---|---|---|---|
 * | 8,000 | 90.8% | 1,340 chars | 9 MB | 68 | — |
 * | 16,000 | 98.6% | 2,062 chars | 14 MB | 33 | 94 ms, 9 genuine misses |
 * | **40,000** | **99.8%** | 2,297 chars | 15 MB | 20 | 138 ms, 5 genuine misses |
 *
 * **This is a real trade, not a free lunch — 40,000 costs ~46% more query time.**
 * Storage barely moves (only ~0.3% of threads are long enough for the cap to
 * bind), but the *bitmap recheck* does: the planner re-evaluates `to_tsvector`
 * over the detoasted column for every candidate row, so on a multi-term search
 * the second term's filter is paid per candidate at full corpus length. On the
 * live two-term `order refund` search that is 94 ms at 16,000 vs 138 ms at
 * 40,000 — against a 2,004 ms baseline for the ILIKE build this replaces, so
 * both are 15–21× faster and both are comfortably interactive.
 *
 * 40,000 wins because **recall is what this step exists to fix** (the retrieval
 * plan's problem statement is "Kopilot cannot reliably find threads"), and
 * 44 ms buys back 4 of 9 missed threads on that query. The decision is one
 * constant plus a re-run of the idempotent backfill
 * (`data-migrations/migrations/069-backfill-thread-search-text.ts`), so reverse
 * it if a mail-search profile ever shows the recheck dominating.
 *
 * What is NOT fixable by any cap is lexeme-vs-substring matching: `to_tsvector`
 * indexes words, so a run-on token like `Iordered` is never found by `order`
 * however large the corpus. That accounts for the 5 misses that remain.
 */
export const THREAD_SEARCH_TOTAL_LIMIT = 40000

// =============================================================================
// SQL
// =============================================================================

/**
 * The `searchText` value for one `Thread`, as a SQL expression correlated to
 * `alias`.
 *
 * Shape: the newest {@link THREAD_SEARCH_MAX_MESSAGES} messages, newest first,
 * each reduced to plain text and clipped to
 * {@link THREAD_SEARCH_MESSAGE_LIMIT}, joined by a space and clipped as a whole
 * to {@link THREAD_SEARCH_TOTAL_LIMIT}. `NULL` when the thread has no body text.
 *
 * Per-message reduction, in order:
 * 1. `textPlain` when present — the provider's own plain-text alternative;
 * 2. otherwise `textHtml` with tags stripped. **Not optional:** 393 of 8,133 dev
 *    messages (4.8%) are HTML-only, and indexing raw HTML would turn `div`,
 *    `td` and every attribute name into lexemes;
 * 3. whitespace collapsed, so a 40-line quoted block doesn't spend the budget on
 *    newlines.
 *
 * Newest-first is what makes the truncation defensible: when a thread does
 * exceed the cap it is the *oldest* quoted material that falls off, not the
 * message the user is actually looking at.
 *
 * Written as a raw string rather than composed Drizzle columns on purpose — a
 * `PgColumn` inside a correlated subquery loses its table qualifier when Drizzle
 * flattens a single-table projection, which would silently self-join the alias.
 * Nothing in this string is caller-supplied, so `sql.raw` is safe.
 *
 * @param alias table alias of the `Thread` row being computed
 */
export function threadSearchTextExpressionSql(alias = 't'): string {
  return `LEFT(NULLIF(TRIM((
    SELECT string_agg(x.txt, ' ' ORDER BY x.rn)
    FROM (
      SELECT
        ROW_NUMBER() OVER (ORDER BY m."sentAt" DESC NULLS LAST, m.id DESC) AS rn,
        LEFT(
          btrim(
            regexp_replace(
              COALESCE(
                NULLIF(m."textPlain", ''),
                regexp_replace(COALESCE(m."textHtml", ''), '<[^>]*>', ' ', 'g')
              ),
              '\\s+', ' ', 'g'
            )
          ),
          ${THREAD_SEARCH_MESSAGE_LIMIT}
        ) AS txt
      FROM "Message" m
      WHERE m."threadId" = ${alias}.id
      ORDER BY m."sentAt" DESC NULLS LAST, m.id DESC
      LIMIT ${THREAD_SEARCH_MAX_MESSAGES}
    ) x
    WHERE x.txt <> ''
  )), ''), ${THREAD_SEARCH_TOTAL_LIMIT})`
}

/**
 * `"searchText" = <expression>` — the assignment clause, for splicing into a
 * `Thread` UPDATE that is already running.
 *
 * This is the preferred maintenance hook: both existing thread-metadata
 * recomputes already issue exactly one `UPDATE "Thread" t SET …` per message
 * write, so the corpus rides along on the statement that maintains
 * `messageCount` / `lastMessageAt` / `latestMessageId`. Anyone who remembers to
 * keep those correct keeps the search corpus correct for free, which is the only
 * durable answer to a denormalization's drift risk.
 *
 * @param alias table alias of the `Thread` row being updated
 */
export function threadSearchTextAssignmentSql(alias = 't'): string {
  return `"searchText" = ${threadSearchTextExpressionSql(alias)}`
}

// =============================================================================
// WRITE PATH
// =============================================================================

/**
 * Recompute `searchText` for one thread as a standalone statement.
 *
 * For write paths that do **not** already run a thread-metadata recompute — the
 * chat channel bumps its counters with a Drizzle `update()` rather than raw SQL,
 * and `storeIgnoredMessage` inserts the thread and the message separately.
 * Prefer {@link threadSearchTextAssignmentSql} wherever an `UPDATE "Thread"` is
 * already in flight; one statement is cheaper than two and cannot half-apply.
 *
 * Accepts a `Transaction` as well as a `Database` so the refresh can commit with
 * the message insert that caused it — a chat message stored without its corpus
 * would be invisible to search until the thread's next write.
 *
 * Deliberately `Promise<void>` rather than a `Result`: every caller treats a
 * search-corpus refresh as part of a write it has already committed, and a
 * failure here must never roll back a stored message. Callers log and continue.
 */
export async function updateThreadSearchText(
  db: Database | Transaction,
  threadId: string
): Promise<void> {
  await db.execute(
    sql`UPDATE "Thread" t SET ${sql.raw(threadSearchTextAssignmentSql('t'))} WHERE t.id = ${threadId}`
  )
}
