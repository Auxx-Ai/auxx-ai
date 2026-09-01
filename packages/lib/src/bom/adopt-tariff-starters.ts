// packages/lib/src/bom/adopt-tariff-starters.ts

/**
 * Turns a picked `(code, country)` pair into a `tariff_code` record and its
 * `tariff_rate` history, sourced from the tariff starter catalogue
 * (plans/money/tasks/32-tariff-starter-catalogue.md §2.1).
 *
 * The writer is the same door `apps/worker/scripts/seed-sample-tariffs.ts` and
 * the settings page already use - `UnifiedCrudHandler.create` for `tariff_code`
 * then each `tariff_rate` - so the label pre-hook, the uniqueness guard and the
 * `tariff-rate-triggers` recalc all fire exactly as they do for a hand-typed
 * code. Nothing here is a seed: this is a person's action from a settings page,
 * run in their own name, with ordinary events (`seedSession` is for
 * migrations).
 *
 * RULES, copied from `seed/gl-account-chart.ts` because they cost the same
 * defects:
 *
 *  1. **Idempotent on `(code, country)`, archived rows included.** A pair the
 *     org already holds - live or archived - is skipped whole and reported.
 *     Never updated, never topped up. Someone who archived `8481.80.90.05 CN`
 *     did not ask for it back.
 *  2. **Sequential, single writer.** Pairs are written one at a time, in
 *     input order. `guardTariffCodeUniqueness` is a check-then-write gate;
 *     two concurrent creates of the same pair would both pass it.
 *  3. **Not a seed session.** Ordinary events, ordinary write session.
 *
 * WHOLE OR NOTHING PER PAIR, AND WHICH ROUTE THIS TAKES
 *
 * A code row landing with only some of its rate rows is exactly the silent
 * undercharge task 29 §3 warns about: the code resolves, the base row is
 * present so the "no base rate" warning never fires, and the schedule reads
 * lower than the catalogue said, with nothing wrong-looking about it.
 * `UnifiedCrudHandler` takes a `Database`, not a `Transaction`
 * (`resources/crud/unified-handler.ts` - the constructor's third parameter).
 * A Drizzle transaction handle does not structurally satisfy `Database`
 * (`Connection` carries a `$client: IPool` a `PgTransaction` does not), so it
 * needs the same cast `builds/complete-build.ts` already uses at its
 * transaction boundary: `tx as unknown as Database`. Nothing in
 * `resources/crud/*` opens a nested transaction (checked: no `.transaction(`
 * call anywhere under `resources/crud/`), so nesting is safe. This file
 * therefore runs **one transaction per pair**: every write for a pair commits
 * together or none of them do, and a failure on one pair aborts the whole call
 * (not just that pair) and reports which pair - later pairs are never
 * attempted, matching rule 2's single-writer sequencing.
 *
 * No permission checks: the router asserts `tariff_code` and `tariff_rate`
 * edit before calling this (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { AuxxError, BadRequestError, NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud'
import { ISO_COUNTRY_OPTIONS } from '../resources/registry/iso-country-options'
import {
  findHtsGeneral,
  type HtsGeneralLine,
  loadHtsGeneral,
  normalizeHtsCode,
} from './tariff-hts-general'
import { expandTariffStarter } from './tariff-starters'

const logger = createScopedLogger('bom:adopt-tariff-starters')

const ISO_COUNTRY_VALUES = new Set(ISO_COUNTRY_OPTIONS.map((option) => option.value))

/** One `(code, country)` pair the caller wants adopted from the catalogue. */
export interface AdoptTariffStartersInput {
  entries: ReadonlyArray<{ code: string; country: string }>
}

/** What one call did, one entry per pair the caller asked for. */
export interface AdoptTariffStartersResult {
  /** Pairs this call created, with the number of rate rows each got. */
  created: Array<{ code: string; country: string; instanceId: string; rows: number }>
  /** Pairs the org already held (archived included), left exactly as they were. */
  skipped: Array<{ code: string; country: string }>
  /** Codes the catalogue does not carry. Refused, not silently dropped. */
  unknown: Array<{ code: string; country: string }>
}

/** An input entry after digit-normalization, carrying the caller's own spelling for reporting. */
interface NormalizedEntry {
  code: string
  country: string
  digits: string
}

function pairKey(digits: string, country: string): string {
  return `${digits}|${country}`
}

/**
 * Drops duplicate `(digits, country)` pairs, keeping the first occurrence's
 * spelling for reporting. Two spellings of the same code (`8481.80.9005` and
 * `8481.80.90.05`) collapse to one pair.
 */
function dedupeEntries(
  entries: ReadonlyArray<{ code: string; country: string }>
): NormalizedEntry[] {
  const seen = new Set<string>()
  const result: NormalizedEntry[] = []
  for (const entry of entries) {
    const digits = normalizeHtsCode(entry.code)
    const key = pairKey(digits, entry.country)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ code: entry.code, country: entry.country, digits })
  }
  return result
}

/**
 * Every `(code, country)` pair the org already holds under `tariff_code`,
 * ARCHIVED ROWS INCLUDED, keyed on normalised digits + country.
 *
 * 🛑 Deliberate, and the opposite of what `guardTariffCodeUniqueness` checks
 * on create (that gate excludes archived rows so a soft-deleted code can be
 * re-registered by hand). Here the gate is "did the org ever adopt this",
 * not "would a create collide" - someone who archived `8481.80.90.05 CN` did
 * not ask this bulk action to bring it back.
 *
 * Matched on normalised digits because an org may have typed a code by hand
 * before this catalogue existed, in a different dot spelling than the
 * catalogue's own 4-2-2-2 printing.
 */
async function loadExistingPairKeys(
  db: Database,
  organizationId: string,
  tariffCodeDefId: string
): Promise<Set<string>> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['tariff_code_code', 'tariff_code_country'] as const)
  const codeField = fields.tariff_code_code
  const countryField = fields.tariff_code_country
  if (!codeField || !countryField) return new Set()

  const codeValue = alias(schema.FieldValue, 'existing_tariff_code_code')
  const countryValue = alias(schema.FieldValue, 'existing_tariff_code_country')

  const rows = await db
    .select({ code: codeValue.valueText, country: countryValue.optionId })
    .from(schema.EntityInstance)
    .innerJoin(
      codeValue,
      and(
        eq(codeValue.entityId, schema.EntityInstance.id),
        eq(codeValue.organizationId, organizationId),
        eq(codeValue.fieldId, codeField.id)
      )
    )
    .innerJoin(
      countryValue,
      and(
        eq(countryValue.entityId, schema.EntityInstance.id),
        eq(countryValue.organizationId, organizationId),
        eq(countryValue.fieldId, countryField.id)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, tariffCodeDefId)
        // No `isNull(archivedAt)` - archived rows are included on purpose, see above.
      )
    )

  const keys = new Set<string>()
  for (const row of rows) {
    if (row.code && row.country) keys.add(pairKey(normalizeHtsCode(row.code), row.country))
  }
  return keys
}

/**
 * Writes one `tariff_code` and its full `tariff_rate` history inside one
 * transaction. Throws (rolling back both) on any failure; the caller decides
 * what that means for the overall call.
 */
async function createPair(
  db: Database,
  organizationId: string,
  userId: string,
  tariffCodeDefId: string,
  tariffRateDefId: string,
  line: HtsGeneralLine,
  country: string
): Promise<{ instanceId: string; rows: number }> {
  const expansion = expandTariffStarter(line, country)

  return db.transaction(async (tx) => {
    // See the file header: `UnifiedCrudHandler` takes a `Database`, not a
    // `Transaction` - this cast is the same one `builds/complete-build.ts`
    // uses at its transaction boundary.
    const txDb = tx as unknown as Database
    const handler = new UnifiedCrudHandler(organizationId, userId, txDb)

    const codeResult = await handler.create(tariffCodeDefId, {
      tariff_code_code: line[0],
      tariff_code_country: country,
      tariff_code_description: expansion.description,
    })
    const codeRecordId = `tariff_code:${codeResult.instance.id}`

    for (const row of expansion.rows) {
      await handler.create(tariffRateDefId, {
        tariff_rate_tariff_code: codeRecordId,
        tariff_rate_rate: row.rate,
        tariff_rate_effective_from: `${row.effectiveFrom}T00:00:00.000Z`,
        ...(row.authority ? { tariff_rate_authority: row.authority } : {}),
        ...(row.chapter99Code ? { tariff_rate_chapter99_code: row.chapter99Code } : {}),
        tariff_rate_note: row.note,
      })
    }

    return { instanceId: codeResult.instance.id, rows: expansion.rows.length }
  })
}

/**
 * Adopts a batch of `(code, country)` pairs from the tariff starter catalogue
 * into `tariff_code` + `tariff_rate` records for one org.
 *
 * Country codes are validated against {@link ISO_COUNTRY_OPTIONS} up front -
 * a bad value here would otherwise fork the `(code, country)` identity the
 * same way a free-text country field would (29 §12 g). Pairs already held by
 * the org (archived included) are skipped and reported, never updated. A code
 * the catalogue does not carry is reported `unknown` rather than silently
 * dropped.
 *
 * Pairs are written sequentially, one transaction each (see the file header
 * for why). The first pair that fails to write aborts the whole call and its
 * error is returned - pairs already committed before it stay committed;
 * pairs after it are never attempted.
 */
export async function adoptTariffStarters(
  db: Database,
  organizationId: string,
  userId: string,
  input: AdoptTariffStartersInput
): Promise<Result<AdoptTariffStartersResult, Error>> {
  for (const entry of input.entries) {
    if (!ISO_COUNTRY_VALUES.has(entry.country)) {
      return err(new BadRequestError(`"${entry.country}" is not a valid ISO-2 country code`))
    }
  }

  const deduped = dedupeEntries(input.entries)

  const [tariffCodeDefId, tariffRateDefId] = await Promise.all([
    getCachedEntityDefId(organizationId, 'tariff_code'),
    getCachedEntityDefId(organizationId, 'tariff_rate'),
  ])
  if (!tariffCodeDefId || !tariffRateDefId) {
    return err(
      new NotFoundError(
        'This org has no tariff_code / tariff_rate definitions yet - nothing to adopt into'
      )
    )
  }

  const catalogue = await loadHtsGeneral()

  const unknown: AdoptTariffStartersResult['unknown'] = []
  const found: Array<{ entry: NormalizedEntry; line: HtsGeneralLine }> = []
  for (const entry of deduped) {
    const line = findHtsGeneral(catalogue.lines, entry.code)
    if (!line) {
      unknown.push({ code: entry.code, country: entry.country })
    } else {
      found.push({ entry, line })
    }
  }

  const existingKeys =
    found.length > 0
      ? await loadExistingPairKeys(db, organizationId, tariffCodeDefId)
      : new Set<string>()

  const skipped: AdoptTariffStartersResult['skipped'] = []
  const toCreate: Array<{ entry: NormalizedEntry; line: HtsGeneralLine }> = []
  for (const item of found) {
    if (existingKeys.has(pairKey(item.entry.digits, item.entry.country))) {
      skipped.push({ code: item.entry.code, country: item.entry.country })
    } else {
      toCreate.push(item)
    }
  }

  const created: AdoptTariffStartersResult['created'] = []
  for (const { entry, line } of toCreate) {
    try {
      const { instanceId, rows } = await createPair(
        db,
        organizationId,
        userId,
        tariffCodeDefId,
        tariffRateDefId,
        line,
        entry.country
      )
      created.push({ code: line[0], country: entry.country, instanceId, rows })
    } catch (error) {
      logger.error('Failed to adopt a tariff starter pair', {
        organizationId,
        code: entry.code,
        country: entry.country,
        error,
      })
      if (error instanceof AuxxError) return err(error)
      const message = error instanceof Error ? error.message : String(error)
      return err(new AuxxError(`Failed to adopt ${entry.code} ${entry.country}: ${message}`))
    }
  }

  logger.info('Adopted tariff starters', {
    organizationId,
    created: created.length,
    skipped: skipped.length,
    unknown: unknown.length,
  })

  return ok({ created, skipped, unknown })
}
