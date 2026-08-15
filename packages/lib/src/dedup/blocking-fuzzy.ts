// packages/lib/src/dedup/blocking-fuzzy.ts
//
// Fuzzy CANDIDATE GENERATION — reads only, no writes, ZERO permission checks
// (lib-module-guide §6). Like `blocking.ts`, this runs as SYSTEM: a scan job has
// no viewer, and the record-scope predicate is applied by the READ path
// (`queries.ts`) in SQL.
//
// 🔴 **The similarity value is discarded, and that is the entire contract of
// this file.** {@link FuzzyCandidate} has no similarity field — deliberately, so
// the number cannot be persisted into a `Signal` or reach `scorePair` even by
// accident. Full-`displayName` trigram scores `john smith`/`jane smith` at
// 0.4666667, ABOVE `william klooth`/`bill klooth` (0.4210526) and
// `bob smith`/`robert smith` (0.3529412), because the surname carries the score.
// If that number ever ranked the queue, the queue would lead with siblings and
// spouses. Trigram does what it is genuinely good at here — cheap, index-backed
// neighbour lookup — and nothing else; the discrimination happens in
// `name-match.ts` against structured `firstName`/`lastName`.
//
// ⚠️ **Known recall limit, measured.** The shared predicate's fuzzy arm clamps
// at `TRIGRAM_THRESHOLD` (0.3). `peggy klooth`/`margaret klooth` scores 0.3181818
// and is found; the same pair on a SHORT surname — `peggy lee`/`margaret lee` —
// scores 0.2105263 and is not, because a short surname cannot carry a nickname
// pair over the threshold on its own. That is why {@link FuzzyBlockAnchors}
// accepts a `surname` anchor: querying the surname alone puts the whole burden
// on the part that actually matches.
//
// ⚠️ **Second recall limit, found by Phase 5 verification and now fixed.** The
// original header claimed the `LIMIT` truncating a common surname's neighbours
// was harmless "because a common surname fails the rarity condition anyway".
// That is wrong: a common surname reaches `medium` through CORROBORATION
// (`Bob Smith` / `Robert Smith` — a case the plan requires), and corroboration
// cannot rescue a pair the blocker never generated. Two changes followed —
// {@link FUZZY_BLOCK_LIMIT} went from 5 to 20, and {@link blockSurnameRecord}
// added an exact-surname anchor pass that does not compete for those slots at
// all. Neither touches the name RULE: precision on `John Smith` / `Jane Smith`
// is unchanged.

import { type Database, schema } from '@auxx/database'
import type { FieldId } from '@auxx/types/field'
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import { recordSearchNameScore, recordSearchPredicate } from '../resources/search/record-search-sql'
import { FUZZY_BLOCK_LIMIT, SURNAME_ANCHOR_LIMIT } from './config'
import { normalizeSurname } from './name-match'
import { NORMALIZED_SURNAME_SQL } from './surname-rarity'

/**
 * One fuzzy neighbour.
 *
 * **No similarity field, on purpose** — see the file header. Everything a
 * downstream scorer is allowed to know about this candidate is its identity and
 * its display columns.
 */
export interface FuzzyCandidate {
  /** `EntityInstance.id` of the neighbour. */
  instanceId: string
  displayName: string | null
  secondaryDisplayValue: string | null
}

/** The strings a record is searched by. */
export interface FuzzyBlockAnchors {
  /** `EntityInstance.displayName` — the primary anchor. */
  displayName?: string | null
  /** `EntityInstance.secondaryDisplayValue` — usually the email (index 0321). */
  secondaryDisplayValue?: string | null
  /**
   * The record's surname, when the caller already has it.
   *
   * An extra, optional recall arm rather than a replacement: see the measured
   * `peggy lee` case in the file header. A surname-only query keeps the trigram
   * score on the part that actually agrees between a nickname pair.
   */
  surname?: string | null
}

/** Parameters for {@link blockFuzzyRecord}. */
export interface BlockFuzzyParams {
  organizationId: string
  entityDefinitionId: string
  /** `EntityInstance.id` of the record being scanned. */
  instanceId: string
  /** Anchors to search by; read from the record when omitted. */
  anchors?: FuzzyBlockAnchors
  /** Per-anchor cap; defaults to {@link FUZZY_BLOCK_LIMIT}. */
  limit?: number
}

/**
 * A query shorter than this yields no full trigram and degrades an `ILIKE
 * '%q%'` arm into a scan that matches most of the definition. Skipped outright.
 */
const MIN_ANCHOR_LENGTH = 3

/** Read a record's own display columns, for callers that do not already have them. */
async function readAnchors(
  db: Database,
  organizationId: string,
  instanceId: string
): Promise<FuzzyBlockAnchors> {
  const [row] = await db
    .select({
      displayName: schema.EntityInstance.displayName,
      secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, instanceId)
      )
    )
    .limit(1)

  return row ?? {}
}

/**
 * Top-K name neighbours of one record.
 *
 * Runs one indexed query per non-empty anchor, each ordered by trigram score and
 * capped at `limit`, then unions the results. The score orders the query and is
 * then thrown away — it never leaves this function.
 *
 * Scoped to the same organization and definition, `archivedAt IS NULL` (matching
 * `blockRecord`'s `excludeArchived: true`, and the partial dedup scan index), and
 * excluding the record itself.
 *
 * The predicate comes from the shared builders (`recordSearchPredicate` →
 * `textSearchPredicate`) rather than hand-rolled `similarity()` SQL: its `%`
 * operator arm is what makes `EntityInstance_org_displayName_trgm_idx` usable at
 * all, and an operator-free `similarity(...) > 0.3` inside an `OR` block
 * forfeits the indexes every other arm would have used (measured: 125 ms vs
 * 32 ms over a 100k-row slice).
 *
 * The threshold is deliberately generous — recall is this function's whole job.
 * Precision comes from `compareStructuredNames` and the surname-rarity
 * condition, never from tightening the blocker.
 *
 * @returns up to `limit` candidates per anchor, deduplicated by instance id.
 */
export async function blockFuzzyRecord(
  db: Database,
  params: BlockFuzzyParams
): Promise<Result<FuzzyCandidate[], Error>> {
  const { organizationId, entityDefinitionId, instanceId } = params
  const limit = params.limit ?? FUZZY_BLOCK_LIMIT
  const anchors = params.anchors ?? (await readAnchors(db, organizationId, instanceId))

  const queries = [
    ...new Set([anchors.displayName, anchors.secondaryDisplayValue, anchors.surname]),
  ]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length >= MIN_ANCHOR_LENGTH)
  if (queries.length === 0) return ok([])

  const byId = new Map<string, FuzzyCandidate>()
  for (const query of queries) {
    const rows = await db
      .select({
        instanceId: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
        secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
          isNull(schema.EntityInstance.archivedAt),
          ne(schema.EntityInstance.id, instanceId),
          recordSearchPredicate(query)
        )
      )
      // Ordering only. The score is never projected, returned or stored.
      .orderBy(desc(recordSearchNameScore(query)))
      .limit(limit)

    for (const row of rows) {
      if (!byId.has(row.instanceId)) byId.set(row.instanceId, row)
    }
  }

  return ok([...byId.values()])
}

/** Parameters for {@link blockSurnameRecord}. */
export interface BlockSurnameParams {
  organizationId: string
  entityDefinitionId: string
  /** `EntityInstance.id` of the record being scanned — never returned to itself. */
  instanceId: string
  /** `CustomField.id` of the surname field, from `resolveNameFieldIds`. */
  surnameFieldId: FieldId
  /** The scanned record's raw surname cell; normalized here. */
  surname: string
  /** Defaults to {@link SURNAME_ANCHOR_LIMIT}. */
  limit?: number
}

/**
 * Every live record in the definition holding the SAME normalized surname.
 *
 * 🔴 **The recall arm the trigram blocker cannot provide.** `blockFuzzyRecord`
 * orders by similarity to the whole anchor string and truncates at
 * {@link FUZZY_BLOCK_LIMIT}, so on a common surname the genuine same-surname
 * candidates compete with trigram neighbours that merely look alike — measured
 * on dev, `Bob Smith` did not have `Robert Smith` among its top neighbours
 * across 19 Smiths. Corroboration cannot rescue a pair the blocker never
 * generated, so `Bob Smith` / `Robert Smith` — a case the plan explicitly
 * requires — was unreachable.
 *
 * This asks the surname FIELD instead of the display name, which removes the
 * competition entirely: every candidate it returns already satisfies condition
 * (a) of the name rule exactly, and the only thing left to decide is the given
 * name. Fixing recall here rather than by loosening the name rule is deliberate
 * — precision on `John Smith` / `Jane Smith` must not move.
 *
 * Normalization is {@link NORMALIZED_SURNAME_SQL}, the same expression
 * `surnameIdf` counts with, so "the same surname" means one thing across the
 * blocker, the comparator and the rarity test.
 *
 * @returns up to `limit` candidates. Ordered by id purely for determinism —
 *   there is no meaningful ranking among exact surname matches.
 */
export async function blockSurnameRecord(
  db: Database,
  params: BlockSurnameParams
): Promise<Result<FuzzyCandidate[], Error>> {
  const { organizationId, entityDefinitionId, instanceId, surnameFieldId } = params
  const normalized = normalizeSurname(params.surname)
  if (!normalized) return ok([])

  const rows = await db
    .selectDistinct({
      instanceId: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
      secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, surnameFieldId as string),
        ne(schema.FieldValue.entityId, instanceId),
        sql`${NORMALIZED_SURNAME_SQL} = ${normalized}`
      )
    )
    .orderBy(schema.EntityInstance.id)
    .limit(params.limit ?? SURNAME_ANCHOR_LIMIT)

  return ok(rows)
}
