// packages/lib/src/participants/search/participant-search-sql.ts
//
// The PARTICIPANT binding of the shared ranked-search builder
// (`search/text-search-sql.ts`). It names `Participant` columns and nothing
// else — the trigram match arm and every scoring primitive come from the shared
// module, so participants, records (`resources/search/record-search-sql.ts`) and
// mail (`mail-query/thread-search-sql.ts`) cannot drift apart.
//
// 🔴 **No visibility predicate lives here.** The participant arm narrows with the
// mail lens (`buildMailVisibilityPredicate`), applied by the caller as an `EXISTS`
// alongside — never inside — this predicate. Same rule the shared module states
// for itself.
//
// **What this binding does NOT take from the shared module: `textSearchPredicate`
// and `textSearchRank`.** Both assume a maintained `tsvector` corpus, and
// `Participant` deliberately has none:
//
//   - `record-search-sql.ts:31-36` measured why stemming is the wrong tool here:
//     `to_tsvector` collapses `ada@acme-supply.io` into a single `email` token, so
//     a tsvector arm cannot match `acme` *inside* an address. Identifier search is
//     exactly the case stemming fails.
//   - Names on this table are one to three short tokens. Stemming buys nothing
//     trigram does not already give.
//   - It would mean adding a maintained `searchText` column to `Participant` plus
//     a write path to keep it fresh, for no measured recall.
//
// So the arms are composed here from the shared *parts*, the same way mail
// composes its own three-arm rank rather than forking the formula.

import { type SQL, sql } from 'drizzle-orm'
import {
  type TextSearchColumns,
  TRIGRAM_WEIGHT,
  textSearchTrigramMatch,
  textSearchTrigramScore,
} from '../../search/text-search-sql'

/**
 * How much an identifier similarity hit counts, against {@link TRIGRAM_WEIGHT}'s
 * 2 on the name.
 *
 * People search a recipient field by name first and by address second, so this
 * sits below the name arm and above nothing. A rank ordering, not a tuned number.
 *
 * ⚠️ On the phone model this arm is close to noise — trigrams over digit strings
 * carry little signal. It stays bounded and the `ILIKE` arms do the real work
 * there; not worth a per-model weight, but do not read the phone measurements as
 * evidence that phone *ranking* works.
 */
const IDENTIFIER_WEIGHT = sql.raw('1')

/**
 * Weight on the recency term.
 *
 * 🔴 **Derived from a bound, not chosen.** {@link participantRecencyScore} is
 * bounded on `[0, 1]`, so this arm contributes at most `0.25` — meaning it can
 * only reorder rows whose name similarity differs by less than `0.125` (the name
 * arm is weighted 2). It breaks ties inside a relevance band and **cannot**
 * promote a clearly worse name match above a better one. That ceiling is the
 * entire reason the recency function had to be bounded; with an unbounded one, any
 * weight here is an unfalsifiable guess.
 */
const RECENCY_WEIGHT = sql.raw('0.25')

/**
 * Recency half-life, in seconds (30 days).
 *
 * **The one genuinely undetermined number in this file**, stated as such rather
 * than dressed up. Nothing measured says 30 days; it says "about a month of
 * correspondence still feels current". Changing it cannot break the
 * {@link RECENCY_WEIGHT} guarantee, which follows from the *bound* on the
 * function rather than from this constant.
 */
const RECENCY_HALF_LIFE_SECONDS = sql.raw('2592000.0')

/**
 * One aliased `Participant` binding.
 *
 * 🔴 **Everything is a raw aliased `SQL` ref, and the alias is carried
 * explicitly.** The consumer (`search-recipients.ts`) is hand-written SQL of the
 * shape `FROM "Participant" p`, and a Drizzle `PgColumn` renders table-qualified
 * (`"Participant"."displayName"`), which Postgres rejects once the table carries
 * an alias — see the `TextSearchRef` note in `search/text-search-sql.ts`. There is
 * no Drizzle-column form here, unlike the record binding's two, because no
 * Drizzle-composed consumer exists and an unused second binding only invites
 * someone to pick the wrong one.
 *
 * `identifier` and `lastSentMessageAt` are fields on this interface rather than
 * being derived from {@link TextSearchColumns}, which has no slot for them.
 * Recovering the alias by string-splitting a rendered chunk would work until the
 * first caller used a different alias.
 */
export interface ParticipantSearchBinding {
  /**
   * The shared-builder view of this table.
   *
   * `document` is bound to `displayName` and **never read**:
   * {@link TextSearchColumns} requires the field, and this binding uses only the
   * trigram primitives (there is no corpus — see the file header). It is not a
   * corpus claim.
   */
  cols: TextSearchColumns
  identifier: SQL
  lastSentMessageAt: SQL
}

/** Build the binding for a given table alias. */
export function participantSearchBinding(alias: string): ParticipantSearchBinding {
  const col = (name: string) => sql.raw(`${alias}."${name}"`)
  return {
    cols: {
      document: col('displayName'),
      rank: col('displayName'),
      fallbacks: [col('displayName'), col('identifier')],
      id: col('id'),
    },
    identifier: col('identifier'),
    lastSentMessageAt: col('lastSentMessageAt'),
  }
}

/**
 * Saturating recency: `1 / (1 + age_in_half_lives)`, `NULL → 0`.
 *
 * The same `r / (r + 1)` shape as `TS_RANK_SATURATING` — strictly decreasing in
 * age, bounded on `(0, 1]` for a real timestamp, and 0 for a participant never
 * mailed. Bounded is the requirement, not a nicety: {@link RECENCY_WEIGHT} is
 * derived against the supremum.
 */
export function participantRecencyScore(binding: ParticipantSearchBinding): SQL<number> {
  return sql<number>`COALESCE(1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - ${binding.lastSentMessageAt})) / ${RECENCY_HALF_LIFE_SECONDS}), 0)`
}

/**
 * The match predicate — a parenthesized `OR` block, safe to `AND` into a `WHERE`
 * that already filters `organizationId`.
 *
 * Arms, all index-servable by the two `gin_trgm_ops` indexes from migration `0334`:
 *
 * ```text
 *   (displayName % q AND similarity(displayName, q) > 0.3)   -- typo tolerance
 *   OR displayName ILIKE '%q%'                              -- short queries
 *   OR identifier  ILIKE '%q%'                              -- address substring
 *   [OR identifier ILIKE '%<pattern>%' …]                   -- phone patterns
 * ```
 *
 * 🔴 **Every arm must be index-servable, or none of them are.** Postgres builds
 * this as a `BitmapOr` of one index scan per arm; a single arm with no index
 * condition makes it abandon the bitmap entirely and filter the whole org slice.
 * Measured on 200k rows / 10k per org: **0.35 ms** with both trigram indexes,
 * **32.6 ms** with only the identifier one, for a byte-identical result set. The
 * fuzzy arm keeps its redundant-looking `%` for the same reason
 * (`text-search-sql.ts:188-225`) — a bare `similarity() > 0.3` is operator-free
 * and therefore never an index condition.
 *
 * ⚠️ **There is deliberately no `name ILIKE` arm.** `Participant.name` is
 * redundant with `displayName` by construction — `calculateDisplayName` returns
 * the trimmed name whenever one exists, and every write site sets the pair
 * together — so the arm could not match a row `displayName` did not, and it would
 * have cost a third GIN index on a hot table. `schema/participant.ts` documents
 * the invariant and names all six writers.
 *
 * @param query The raw user query, used for the name arms.
 * @param phonePatterns From `phoneSearchPatterns` — `[]` adds no arm. Never pass
 *   a bare `\D` strip; that is wrong outside the NANP for the reason documented
 *   there.
 */
export function participantSearchPredicate(
  query: string,
  binding: ParticipantSearchBinding,
  phonePatterns: readonly string[] = []
): SQL {
  const like = `%${query}%`
  const arms: SQL[] = [
    textSearchTrigramMatch(query, binding.cols),
    ...binding.cols.fallbacks.map((fallback) => sql`${fallback} ILIKE ${like}`),
    ...phonePatterns.map((pattern) => sql`${binding.identifier} ILIKE ${`%${pattern}%`}`),
  ]
  return sql`(${sql.join(arms, sql` OR `)})`
}

/**
 * The relevance score:
 *
 * ```text
 *   2    × similarity(displayName, q)
 * + 1    × similarity(identifier,  q)
 * + 0.25 × recency
 * ```
 *
 * each `COALESCE`d to 0 so a row matching one arm still ranks. The name weight is
 * {@link TRIGRAM_WEIGHT}, imported rather than retyped as `2` — the same number
 * the record and mail bindings weight their name arm with.
 *
 * ⚠️ **Non-deterministic across calls**, because `now()` moves. Safe here and only
 * here: this endpoint has no cursor (a recipient picker shows ~20 and you refine
 * by typing), so no keyset can disagree with a re-evaluated rank. 🔴 If paging is
 * ever added this becomes a skip/duplicate bug of exactly the kind
 * `text-search-sql.ts` exists to prevent — pin `now()` into a parameter first, or
 * leave the recency arm out of the cursor's expression.
 */
export function participantSearchRank(
  query: string,
  binding: ParticipantSearchBinding
): SQL<number> {
  const nameScore = textSearchTrigramScore(query, binding.cols)
  const identifierScore = sql<number>`similarity(${binding.identifier}, ${query})`
  return sql<number>`(COALESCE(${nameScore}, 0) * ${TRIGRAM_WEIGHT} + COALESCE(${identifierScore}, 0) * ${IDENTIFIER_WEIGHT} + ${participantRecencyScore(binding)} * ${RECENCY_WEIGHT})`
}
