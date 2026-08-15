// packages/lib/src/dedup/queries.ts
//
// Reads for the duplicate review queue — the surface half of `pairs.ts`.
// Functional Drizzle + neverthrow, `db` first, no service class.
//
// ZERO permission DECISIONS live here (lib-module-guide §6): the router decides
// which definitions the caller may read and hands the resolved predicates in as
// {@link DuplicateDefScope}. But the resulting SQL is applied HERE, because a
// pair read is the one shape where a post-fetch filter is not equivalent — a
// pair carries the *other* record's display name, so a row that is later
// dropped in JS has already been read into the process and, worse, would be
// trivially re-derivable from a count. Scope lands in the query.
//
// **Both sides must survive every filter.** A pair whose other side is invisible
// or archived is excluded outright rather than rendered half-populated: half a
// duplicate card is both useless and a leak.

import { type Database, schema } from '@auxx/database'
import { aliasedTable, and, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import type { Band, Signal } from './types'

const T = schema.DuplicateSuggestion

/**
 * `EntityInstance` under two aliases — the pair's two sides.
 *
 * The alias names are load-bearing: the caller-supplied record-scope predicates
 * ({@link DuplicateDefScope}) correlate against `"dupLow"."id"` / `"dupHigh"."id"`
 * as RAW identifiers, because a Drizzle `Column` inside an `sql` fragment can be
 * rewritten to a bare, unqualified name (see `record-visibility-scope.ts`).
 */
const LOW = aliasedTable(schema.EntityInstance, 'dupLow')
const HIGH = aliasedTable(schema.EntityInstance, 'dupHigh')

/** Correlation targets a caller builds its scope predicates against. */
export const DUPLICATE_LOW_INSTANCE_ID_SQL = sql.raw('"dupLow"."id"')
export const DUPLICATE_HIGH_INSTANCE_ID_SQL = sql.raw('"dupHigh"."id"')

/**
 * One definition the caller may read pairs for, with the per-side record-scope
 * predicate that definition needs.
 *
 * A definition the caller can reach NOTHING of (scope arm 4) must simply be
 * absent from the list — that is the "no reachable rows ⇒ no query" contract the
 * record lane already states. `lowWhere`/`highWhere` are absent on arm 1, where
 * the member sees every row and the read must pay nothing.
 */
export interface DuplicateDefScope {
  /** Canonical `EntityDefinition.id` — the keyspace `DuplicateSuggestion` stores. */
  entityDefinitionId: string
  /** Narrows the LOW side; built against {@link DUPLICATE_LOW_INSTANCE_ID_SQL}. */
  lowWhere?: SQL
  /** Narrows the HIGH side; built against {@link DUPLICATE_HIGH_INSTANCE_ID_SQL}. */
  highWhere?: SQL
}

/** Display columns for one side of a pair, joined from `EntityInstance`. */
export interface DuplicateSide {
  instanceId: string
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
  firstInteractionAt: Date | null
  lastInteractionAt: Date | null
  /** `EntityInstance.createdAt` — the final merge-target tiebreak. */
  createdAt: Date | null
}

/** One open pair, both sides hydrated. */
export interface DuplicatePair {
  id: string
  entityDefinitionId: string
  score: number
  band: Band
  signals: Signal[]
  createdAt: Date
  low: DuplicateSide
  high: DuplicateSide
}

/**
 * One CLUSTER, represented by its best-scoring pair.
 *
 * 🔴 **One item per connected component, not one per pair.** The store's unit is
 * the pair, but the reviewer's unit is the cluster: three records that all
 * duplicate each other are three stored pairs offering the SAME merge, and
 * rendering them as three rows meant two of them read as the same pair reversed.
 * Measured during Phase 5 verification: five clusters ate 15 of 25 visible slots.
 * The union-find below now decides which rows exist, not just what they are
 * annotated with.
 *
 * `score`, `band` and `signals` are the representative pair's — the highest
 * scoring one in the component, since the page arrives score-desc and the first
 * pair seen for a component wins.
 */
export interface DuplicatePairListItem extends DuplicatePair {
  /**
   * Every instance id in this component, reachable through other open pairs **in
   * the same page** (union-find at read).
   *
   * Page-local by construction, and deliberately so: completing a cluster across
   * the whole queue would need a second, unbounded query per page. A component
   * split across a page boundary — and ONLY that case — still shows up as two
   * rows: noisier, never wrong.
   */
  clusterInstanceIds: string[]
  /**
   * The same component's records, hydrated. Every member is a side of some pair
   * in the page (that is what page-local means), so this costs no extra query.
   */
  clusterSides: DuplicateSide[]
}

/** Keyset position — score first, id as the tiebreak, both descending. */
export interface DuplicateCursor {
  score: number
  id: string
}

const DEFAULT_LIMIT = 25

/**
 * Snoozed is not a status: it is `open` plus a future `snoozeUntil`, so the pair
 * returns to the queue on its own with no sweep to un-snooze it.
 */
function notSnoozed(now: Date): SQL {
  return or(isNull(T.snoozeUntil), lt(T.snoozeUntil, now)) as SQL
}

/**
 * The caller's record scope, as one predicate.
 *
 * Definitions with no per-side narrowing collapse into a single `IN (…)` — the
 * overwhelmingly common shape, and the one the queue index can serve. Only the
 * rare restricted / grant-only definitions get their own `AND`ed arm.
 */
function buildScopePredicate(scopes: readonly DuplicateDefScope[]): SQL | undefined {
  const plain: string[] = []
  const arms: SQL[] = []

  for (const scope of scopes) {
    if (!scope.lowWhere && !scope.highWhere) {
      plain.push(scope.entityDefinitionId)
      continue
    }
    arms.push(
      and(
        eq(T.entityDefinitionId, scope.entityDefinitionId),
        scope.lowWhere,
        scope.highWhere
      ) as SQL
    )
  }

  if (plain.length > 0) arms.unshift(inArray(T.entityDefinitionId, plain))
  if (arms.length === 0) return undefined
  return arms.length === 1 ? arms[0] : (or(...arms) as SQL)
}

/**
 * The filters EVERY read path shares (§3.1a rule 1).
 *
 * `archivedAt IS NULL` on **both** sides is the invariant, not the hygiene.
 * `deleteOpenPairsForRecord` already removes an archived record's open pairs at
 * archive time, but write-path hooks in this codebase get bypassed routinely
 * (`skipEvents`, `bypassFieldGuards`, bulk paths, direct DB writes), so
 * correctness must not depend on one having run. Applying it on `list` alone —
 * which is what the plan originally said — would have made `count` (the
 * notification badge) count pairs the list refuses to render.
 */
function openPairFilters(organizationId: string, now: Date, scope: SQL | undefined): SQL {
  return and(
    eq(T.organizationId, organizationId),
    eq(T.status, 'open'),
    isNull(LOW.archivedAt),
    isNull(HIGH.archivedAt),
    notSnoozed(now),
    scope
  ) as SQL
}

/** The projection both list shapes share. */
const PAIR_COLUMNS = {
  id: T.id,
  entityDefinitionId: T.entityDefinitionId,
  score: T.score,
  band: T.band,
  signals: T.signals,
  createdAt: T.createdAt,
  lowId: T.instanceIdLow,
  lowDisplayName: LOW.displayName,
  lowSecondary: LOW.secondaryDisplayValue,
  lowAvatarUrl: LOW.avatarUrl,
  lowFirstInteractionAt: LOW.firstInteractionAt,
  lowLastInteractionAt: LOW.lastInteractionAt,
  lowCreatedAt: LOW.createdAt,
  highId: T.instanceIdHigh,
  highDisplayName: HIGH.displayName,
  highSecondary: HIGH.secondaryDisplayValue,
  highAvatarUrl: HIGH.avatarUrl,
  highFirstInteractionAt: HIGH.firstInteractionAt,
  highLastInteractionAt: HIGH.lastInteractionAt,
  highCreatedAt: HIGH.createdAt,
} as const

type PairRow = {
  [K in keyof typeof PAIR_COLUMNS]: unknown
}

function toPair(row: PairRow): DuplicatePair {
  return {
    id: row.id as string,
    entityDefinitionId: row.entityDefinitionId as string,
    score: row.score as number,
    band: row.band as Band,
    signals: (row.signals ?? []) as Signal[],
    createdAt: row.createdAt as Date,
    low: {
      instanceId: row.lowId as string,
      displayName: (row.lowDisplayName ?? null) as string | null,
      secondaryDisplayValue: (row.lowSecondary ?? null) as string | null,
      avatarUrl: (row.lowAvatarUrl ?? null) as string | null,
      firstInteractionAt: (row.lowFirstInteractionAt ?? null) as Date | null,
      lastInteractionAt: (row.lowLastInteractionAt ?? null) as Date | null,
      createdAt: (row.lowCreatedAt ?? null) as Date | null,
    },
    high: {
      instanceId: row.highId as string,
      displayName: (row.highDisplayName ?? null) as string | null,
      secondaryDisplayValue: (row.highSecondary ?? null) as string | null,
      avatarUrl: (row.highAvatarUrl ?? null) as string | null,
      firstInteractionAt: (row.highFirstInteractionAt ?? null) as Date | null,
      lastInteractionAt: (row.highLastInteractionAt ?? null) as Date | null,
      createdAt: (row.highCreatedAt ?? null) as Date | null,
    },
  }
}

/** Parameters for {@link listDuplicatePairs}. */
export interface ListDuplicatePairsParams {
  organizationId: string
  /** The definitions the caller may read, with their per-side scope. */
  scopes: readonly DuplicateDefScope[]
  cursor?: DuplicateCursor
  limit?: number
  /** Narrow to one definition — must already be present in {@link scopes}. */
  entityDefinitionId?: string
  /** Injected for tests; defaults to `new Date()`. */
  now?: Date
}

/** {@link listDuplicatePairs}'s page. */
export interface DuplicatePairPage {
  items: DuplicatePairListItem[]
  nextCursor: DuplicateCursor | null
}

/**
 * The review queue: open, non-snoozed, unarchived pairs the caller can see BOTH
 * sides of, best-scoring first.
 *
 * Ordered `(score desc, id desc)` — the id tiebreak is what makes the keyset
 * cursor total, since `score` is a `double precision` that ties constantly (every
 * `high` pair produced by a single strong key scores identically).
 */
export async function listDuplicatePairs(
  db: Database,
  params: ListDuplicatePairsParams
): Promise<Result<DuplicatePairPage, Error>> {
  const { organizationId, cursor, entityDefinitionId } = params
  const limit = params.limit ?? DEFAULT_LIMIT
  const now = params.now ?? new Date()

  const scopes = entityDefinitionId
    ? params.scopes.filter((scope) => scope.entityDefinitionId === entityDefinitionId)
    : params.scopes

  // Arm 4, generalized: nothing is reachable, so no query is issued at all.
  if (scopes.length === 0) return ok({ items: [], nextCursor: null })

  const keyset = cursor
    ? (or(lt(T.score, cursor.score), and(eq(T.score, cursor.score), lt(T.id, cursor.id))) as SQL)
    : undefined

  const rows = await db
    .select(PAIR_COLUMNS)
    .from(T)
    .innerJoin(LOW, eq(LOW.id, T.instanceIdLow))
    .innerJoin(HIGH, eq(HIGH.id, T.instanceIdHigh))
    .where(and(openPairFilters(organizationId, now, buildScopePredicate(scopes)), keyset))
    .orderBy(desc(T.score), desc(T.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = (hasMore ? rows.slice(0, limit) : rows).map(toPair)
  const clusters = clusterInstanceIds(page)

  // Every side in the page, so a component can be hydrated without a second query.
  const sideById = new Map<string, DuplicateSide>()
  for (const pair of page) {
    sideById.set(pair.low.instanceId, pair.low)
    sideById.set(pair.high.instanceId, pair.high)
  }

  // ONE item per component. The page is score-desc, so the first pair seen for a
  // component is its best-scoring one and becomes the representative.
  const emitted = new Set<string>()
  const items: DuplicatePairListItem[] = []
  for (const pair of page) {
    const members = clusters.get(pair.low.instanceId) ?? [pair.low.instanceId, pair.high.instanceId]
    const componentKey = [...members].sort().join('|')
    if (emitted.has(componentKey)) continue
    emitted.add(componentKey)

    items.push({
      ...pair,
      clusterInstanceIds: members,
      clusterSides: members.flatMap((id) => {
        const side = sideById.get(id)
        return side ? [side] : []
      }),
    })
  }

  // The cursor tracks the last ROW read, not the last item emitted — collapsing
  // happens after paging, so a page that yields three items still has to resume
  // from the pair it stopped at or the next page would repeat rows.
  const last = page.at(-1)
  return ok({
    items,
    nextCursor: hasMore && last ? { score: last.score, id: last.id } : null,
  })
}

/**
 * Union-find over the page's pairs → `instanceId → every id in its component`.
 *
 * Clustering lives at READ time by design (see the schema docstring): the stored
 * unit is the pair, so one side can be dismissed or merged without invalidating
 * its neighbours. The cost is that a cluster is only ever as complete as the set
 * of pairs in hand.
 *
 * Its output decides which ROWS the queue has, not merely how they are
 * annotated — see {@link DuplicatePairListItem}.
 */
function clusterInstanceIds(pairs: DuplicatePair[]): Map<string, string[]> {
  const parent = new Map<string, string>()

  const find = (id: string): string => {
    let root = parent.get(id) ?? id
    if (root === id) return id
    root = find(root)
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  for (const pair of pairs) {
    if (!parent.has(pair.low.instanceId)) parent.set(pair.low.instanceId, pair.low.instanceId)
    if (!parent.has(pair.high.instanceId)) parent.set(pair.high.instanceId, pair.high.instanceId)
    union(pair.low.instanceId, pair.high.instanceId)
  }

  const members = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    const bucket = members.get(root)
    if (bucket) bucket.push(id)
    else members.set(root, [id])
  }

  const byInstance = new Map<string, string[]>()
  for (const id of parent.keys()) byInstance.set(id, members.get(find(id)) ?? [id])
  return byInstance
}

/** Parameters for {@link listDuplicatePairsForRecord}. */
export interface ListPairsForRecordParams {
  organizationId: string
  /** `EntityInstance.id` of the record the indicator is mounted on. */
  instanceId: string
  scopes: readonly DuplicateDefScope[]
  limit?: number
  now?: Date
}

/**
 * Open pairs touching one record — the per-record header indicator.
 *
 * Same scope and archived rules as {@link listDuplicatePairs}, for the same
 * reason: the caller may be able to see THIS record and not the other side, and
 * the other side's name is exactly what this read returns.
 */
export async function listDuplicatePairsForRecord(
  db: Database,
  params: ListPairsForRecordParams
): Promise<Result<DuplicatePair[], Error>> {
  const { organizationId, instanceId, scopes } = params
  const now = params.now ?? new Date()
  if (scopes.length === 0) return ok([])

  const rows = await db
    .select(PAIR_COLUMNS)
    .from(T)
    .innerJoin(LOW, eq(LOW.id, T.instanceIdLow))
    .innerJoin(HIGH, eq(HIGH.id, T.instanceIdHigh))
    .where(
      and(
        openPairFilters(organizationId, now, buildScopePredicate(scopes)),
        or(eq(T.instanceIdLow, instanceId), eq(T.instanceIdHigh, instanceId))
      )
    )
    .orderBy(desc(T.score), desc(T.id))
    .limit(params.limit ?? DEFAULT_LIMIT)

  return ok(rows.map(toPair))
}

/** Parameters for {@link countOpenDuplicatePairs}. */
export interface CountDuplicatePairsParams {
  organizationId: string
  scopes: readonly DuplicateDefScope[]
  now?: Date
}

/**
 * How many pairs the review queue would render — the notification badge's term.
 *
 * Carries the SAME archived, snooze and scope filters as
 * {@link listDuplicatePairs} and not one filter fewer. A badge that counts a
 * different set than the tab shows is the drift failure the shared count hook
 * exists to prevent, arriving through the back door.
 *
 * ⚠️ It counts **pairs**, while the list renders one row per CLUSTER, so an org
 * with multi-record clusters sees a badge above its rendered row count. That is
 * deliberate and is not the drift this warns about: the badge answers "how much
 * duplicate evidence is outstanding", and counting components instead would need
 * the union-find over every open pair in the org — unbounded, on a query that
 * runs every time the bell opens.
 */
export async function countOpenDuplicatePairs(
  db: Database,
  params: CountDuplicatePairsParams
): Promise<Result<number, Error>> {
  const { organizationId, scopes } = params
  const now = params.now ?? new Date()
  if (scopes.length === 0) return ok(0)

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(T)
    .innerJoin(LOW, eq(LOW.id, T.instanceIdLow))
    .innerJoin(HIGH, eq(HIGH.id, T.instanceIdHigh))
    .where(openPairFilters(organizationId, now, buildScopePredicate(scopes)))

  return ok(row?.count ?? 0)
}

/** Parameters for {@link getVisibleDuplicatePair}. */
export interface GetDuplicatePairParams {
  organizationId: string
  pairId: string
  scopes: readonly DuplicateDefScope[]
}

/**
 * One pair by id, subject to the same scope and archived rules — the
 * resolve-then-authorize read every pair MUTATION goes through.
 *
 * Status is deliberately NOT filtered: a caller dismissing an already-dismissed
 * pair deserves a truthful answer from the router rather than a 404 that blames
 * the id. Snooze is not filtered either — re-snoozing a snoozed pair is legal.
 */
export async function getVisibleDuplicatePair(
  db: Database,
  params: GetDuplicatePairParams
): Promise<Result<DuplicatePair | null, Error>> {
  const { organizationId, pairId, scopes } = params
  if (scopes.length === 0) return ok(null)

  const [row] = await db
    .select(PAIR_COLUMNS)
    .from(T)
    .innerJoin(LOW, eq(LOW.id, T.instanceIdLow))
    .innerJoin(HIGH, eq(HIGH.id, T.instanceIdHigh))
    .where(
      and(
        eq(T.organizationId, organizationId),
        eq(T.id, pairId),
        isNull(LOW.archivedAt),
        isNull(HIGH.archivedAt),
        buildScopePredicate(scopes)
      )
    )
    .limit(1)

  return ok(row ? toPair(row) : null)
}

/**
 * How well established a record is — the input to merge-TARGET defaulting
 * (plan §3.4).
 *
 * `MergeDialog` defaults its target to the first id it is handed, which in
 * pair order is arbitrary. The surviving record's id is what links and external
 * references keep pointing at while the archived one's id dies, so "merged into
 * the empty stub" is a real and irreversible-feeling mistake.
 *
 * ⚠ **The plan's middle term — raw interaction COUNT — is deliberately not
 * here.** There is no interaction counter on `EntityInstance`; computing one
 * means aggregating `MessageParticipant` per record, which for a page of 25
 * pairs is 50 correlated aggregates over a contact's entire message history —
 * far too much for a query that runs every time the notification bell opens.
 * `firstInteractionAt` (backfilled, indexed, already on the row) answers the
 * same question well enough: whether the record has any interaction history at
 * all, and how far back it goes.
 */
export interface MergeEstablishment {
  instanceId: string
  /**
   * The org has previously SENT to a participant linked to this record — the
   * strongest available "this is the address people actually use" evidence.
   */
  hasOutboundHistory: boolean
}

/**
 * Outbound-history flags for a bounded set of records, in one grouped query.
 *
 * Grouped rather than correlated per row so the cost is one index scan over
 * `Participant_entityInstanceId_idx`, not one per side of every listed pair.
 * Records with no participant row are simply absent from the result — callers
 * read a missing entry as `false`.
 */
export async function readMergeEstablishment(
  db: Database,
  organizationId: string,
  instanceIds: readonly string[]
): Promise<Result<MergeEstablishment[], Error>> {
  const ids = [...new Set(instanceIds)]
  if (ids.length === 0) return ok([])

  // `inArray`, never `= ANY(${ids}::text[])` in a raw fragment — the latter
  // silently matches ZERO rows under Drizzle's `sql` template, with no error.
  const rows = await db
    .select({
      instanceId: schema.Participant.entityInstanceId,
      hasOutboundHistory: sql<boolean>`bool_or(${schema.Participant.hasReceivedMessage})`,
    })
    .from(schema.Participant)
    .where(
      and(
        eq(schema.Participant.organizationId, organizationId),
        inArray(schema.Participant.entityInstanceId, ids)
      )
    )
    .groupBy(schema.Participant.entityInstanceId)

  return ok(
    rows.flatMap((row) =>
      row.instanceId
        ? [{ instanceId: row.instanceId, hasOutboundHistory: Boolean(row.hasOutboundHistory) }]
        : []
    )
  )
}

/**
 * Order instance ids **best-established first** — what a merge opened from a
 * duplicate suggestion hands `MergeDialog` as `baseRecordIds`.
 *
 * Scoped to the suggestion entry point on purpose: every other `MergeDialog`
 * caller keeps its own ordering, because elsewhere the first id is a deliberate
 * user selection rather than an artefact of canonical pair order.
 *
 * Ladder: outbound history → has any interaction history → oldest
 * `firstInteractionAt` → **oldest `createdAt`** → id (so the order is total and
 * stable).
 *
 * 🔴 **The `createdAt` rung is load-bearing, not a formality.** Two records with
 * no participant rows and no interaction history — which is every pair the name
 * rule surfaces, and the whole reason this ordering exists — tie on the first
 * three terms, and the id fallback is a cuid2, i.e. arbitrary. This function
 * exists to stop merges defaulting INTO the empty stub, so where nothing else
 * distinguishes the two, the record that has existed longer is the one whose id
 * other things are most likely to point at.
 */
export function orderByEstablishment(
  sides: readonly DuplicateSide[],
  establishment: readonly MergeEstablishment[]
): string[] {
  const outbound = new Map(establishment.map((row) => [row.instanceId, row.hasOutboundHistory]))
  const rank = (side: DuplicateSide) => ({
    outbound: outbound.get(side.instanceId) ? 1 : 0,
    interacted: side.firstInteractionAt ? 1 : 0,
    // `Infinity - Infinity` is NaN, which a comparator reads as "equal" and
    // falls through — the intended behaviour when neither side has interacted,
    // but only because the next rung exists to answer it.
    since: side.firstInteractionAt?.getTime() ?? Number.POSITIVE_INFINITY,
    // Unknown `createdAt` sorts last: it cannot claim to be the older record.
    created: side.createdAt?.getTime() ?? Number.POSITIVE_INFINITY,
  })

  return [...sides]
    .sort((a, b) => {
      const left = rank(a)
      const right = rank(b)
      return (
        right.outbound - left.outbound ||
        right.interacted - left.interacted ||
        left.since - right.since ||
        left.created - right.created ||
        a.instanceId.localeCompare(b.instanceId)
      )
    })
    .map((side) => side.instanceId)
}
