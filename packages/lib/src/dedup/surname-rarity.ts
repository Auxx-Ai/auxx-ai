// packages/lib/src/dedup/surname-rarity.ts
//
// Name-field reads — READS ONLY, no writes, ZERO permission checks
// (lib-module-guide §6). Which fields hold the given name and the surname, what
// two records actually have in those fields, and how rare a surname is inside
// one org+definition.
//
// 🔴 **This is the ONLY place inverse frequency is used in this feature.** An
// earlier revision proposed replacing the role-email denylist and `BLOCK_CAP`
// with Fellegi–Sunter style inverse-frequency weighting on every key; that was
// rejected, because it solves a PRECISION problem the denylist and the cap
// already handle while this feature's real difficulty is RECALL. Surname rarity
// is the one job where inverse frequency is decisive: it is what makes
// "name alone, no corroboration" safe for `Bill Klooth` / `William Klooth`
// while refusing it for two of a hundred Smiths.

import { type Database, schema } from '@auxx/database'
import type { FieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { SURNAME_RARE_MAX_SHARE, SURNAME_RARE_MIN_COUNT } from './config'
import { normalizeSurname, type StructuredName } from './name-match'

/** The two `CustomField` rows the structured comparator reads, for one definition. */
export interface NameFieldIds {
  givenNameFieldId?: FieldId
  surnameFieldId?: FieldId
}

const DEFAULT_GIVEN_NAME_ATTRIBUTE: SystemAttribute = 'first_name'
const DEFAULT_SURNAME_ATTRIBUTE: SystemAttribute = 'last_name'

/**
 * Resolve the given-name and surname `CustomField.id`s for one definition.
 *
 * Contact `firstName` / `lastName` carry `dbColumn: 'firstName' | 'lastName'`
 * in the registry, but neither column exists on `EntityInstance`, so
 * `categorizeFields` routes them to `FieldValue` like any other field
 * (`field-value-queries.ts:570-586`). They are ordinary TEXT `CustomField` rows
 * — verified on dev: 29 orgs × `first_name`/`last_name`, 1147 non-null
 * `last_name` values.
 *
 * Read from the table rather than the org cache so a scan job holds no cache
 * dependency; the result is stable per definition and callers resolve it once
 * per scan, not once per pair.
 */
export async function resolveNameFieldIds(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  attributes: { givenName?: SystemAttribute; surname?: SystemAttribute } = {}
): Promise<Result<NameFieldIds, Error>> {
  const givenNameAttribute = attributes.givenName ?? DEFAULT_GIVEN_NAME_ATTRIBUTE
  const surnameAttribute = attributes.surname ?? DEFAULT_SURNAME_ATTRIBUTE

  const rows = await db
    .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
        inArray(schema.CustomField.systemAttribute, [givenNameAttribute, surnameAttribute])
      )
    )

  const byAttribute = new Map(rows.map((row) => [row.systemAttribute, row.id as FieldId]))
  return ok({
    givenNameFieldId: byAttribute.get(givenNameAttribute),
    surnameFieldId: byAttribute.get(surnameAttribute),
  })
}

/**
 * Read the structured name of several records at once.
 *
 * One query for the whole candidate set — the fuzzy path scores a record
 * against a handful of neighbours, and a per-record read would turn that into a
 * round-trip per candidate.
 *
 * Records with neither part set are absent from the map rather than present and
 * empty: a blank name is an absence of evidence, and `compareStructuredNames`
 * refuses to match on it anyway.
 */
export async function readStructuredNames(
  db: Database,
  organizationId: string,
  instanceIds: string[],
  fields: NameFieldIds
): Promise<Result<Map<string, StructuredName>, Error>> {
  const fieldIds = [fields.givenNameFieldId, fields.surnameFieldId].filter(
    (id): id is FieldId => !!id
  )
  if (instanceIds.length === 0 || fieldIds.length === 0) return ok(new Map())

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, instanceIds),
        inArray(
          schema.FieldValue.fieldId,
          fieldIds.map((id) => id as string)
        )
      )
    )

  const names = new Map<string, StructuredName>()
  for (const row of rows) {
    if (!row.valueText || row.valueText.trim() === '') continue
    const existing = names.get(row.entityId) ?? {}
    if (row.fieldId === fields.givenNameFieldId) existing.firstName = row.valueText
    else if (row.fieldId === fields.surnameFieldId) existing.lastName = row.valueText
    names.set(row.entityId, existing)
  }
  return ok(names)
}

/** How common a surname is inside one org+definition. */
export interface SurnameRarity {
  /** The normalized surname the counts are for. */
  surname: string
  /** Live records in the definition carrying it. */
  count: number
  /** Live records in the definition carrying ANY surname — the corpus. */
  total: number
  /**
   * `ln((total + 1) / (count + 1))` — inverse document frequency, reported for
   * tuning and logging. {@link rare} is the decision; this is the evidence.
   */
  idf: number
  /** Condition (c) of the name-alone rule. */
  rare: boolean
}

/**
 * Normalize a surname the same way {@link normalizeSurname} does, but in SQL, so
 * the count and the comparison agree on what "the same surname" means.
 *
 * ⚠️ One deliberate gap: `unaccent` is not installed (only `vector` and
 * `pg_trgm` are), so diacritics survive here while the JS side folds them.
 * `Müller` and `Muller` are therefore counted as two surnames rather than one,
 * which makes each look marginally RARER. Bounded and rare enough to accept over
 * adding an extension; revisit if it ever shows up in dismissal data.
 */
export const NORMALIZED_SURNAME_SQL = sql`btrim(lower(regexp_replace(${schema.FieldValue.valueText}, '[^a-zA-Z0-9]+', ' ', 'g')))`

/**
 * How rare is this surname in this org and definition?
 *
 * Condition **(c)** of the name-alone rule. A surname is rare when it is held by
 * no more than `max(SURNAME_RARE_MIN_COUNT, ceil(total × SURNAME_RARE_MAX_SHARE))`
 * live records — whichever bound is more generous.
 *
 * **Two bounds because one of them always breaks.** A pure share test needs 500
 * contacts before any surname can clear it, so young orgs would never see the
 * rule fire; a pure count floor stops firing as an org grows past a few thousand
 * records, where most surnames appear more than three times. Together they say
 * the thing that was actually meant: *this surname does not identify a crowd
 * here.*
 *
 * Counts live records only (`archivedAt IS NULL`), matching every other blocking
 * path — an archived record is neither a candidate nor part of the corpus.
 *
 * **Memoize per scan.** The aggregate walks the definition's surname values, so
 * a caller scoring twenty candidates against one record should resolve rarity
 * once for that record's surname rather than once per pair.
 *
 * @param surname - raw cell value; normalized here.
 *
 * @example
 * ```typescript
 * const rarity = (await surnameIdf(db, orgId, defId, 'Klooth'))._unsafeUnwrap()
 * // → { surname: 'klooth', count: 2, total: 1147, idf: 5.9…, rare: true }
 * ```
 */
export async function surnameIdf(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  surname: string,
  options: { surnameFieldId?: FieldId } = {}
): Promise<Result<SurnameRarity, Error>> {
  const normalized = normalizeSurname(surname)
  const empty: SurnameRarity = { surname: normalized, count: 0, total: 0, idf: 0, rare: false }
  if (!normalized) return ok(empty)

  let surnameFieldId = options.surnameFieldId
  if (!surnameFieldId) {
    const resolved = await resolveNameFieldIds(db, organizationId, entityDefinitionId)
    // Re-wrapped, not returned: `err<T, E>` takes the OK type FIRST, so passing
    // an `Err<NameFieldIds, Error>` straight through is a type error here.
    if (resolved.isErr()) return err<SurnameRarity, Error>(resolved.error)
    surnameFieldId = resolved.value.surnameFieldId
  }
  // A definition with no surname field cannot satisfy condition (a) either, so
  // there is nothing to be rare: fail CLOSED rather than report `rare: true`.
  if (!surnameFieldId) return ok(empty)

  const [row] = await db
    .select({
      matched: sql<number>`count(DISTINCT ${schema.FieldValue.entityId}) FILTER (WHERE ${NORMALIZED_SURNAME_SQL} = ${normalized})`,
      total: sql<number>`count(DISTINCT ${schema.FieldValue.entityId})`,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityDefinitionId, entityDefinitionId),
        eq(schema.FieldValue.fieldId, surnameFieldId as string),
        sql`${NORMALIZED_SURNAME_SQL} <> ''`
      )
    )

  const count = Number(row?.matched ?? 0)
  const total = Number(row?.total ?? 0)
  const threshold = Math.max(SURNAME_RARE_MIN_COUNT, Math.ceil(total * SURNAME_RARE_MAX_SHARE))

  return ok({
    surname: normalized,
    count,
    total,
    idf: Math.log((total + 1) / (count + 1)),
    // `count === 0` means the surname is not in the corpus at all — which
    // happens when the caller passes a value that was never persisted. Treat it
    // as unknown, not as maximally rare.
    rare: count > 0 && count <= threshold,
  })
}
