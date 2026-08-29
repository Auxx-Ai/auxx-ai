// packages/lib/src/postings/opening-baseline.ts
//
// The opening baseline: what the books were worth the day auxx.ai took them over.
//
// The month-end inventory entry posts a DELTA — `target − what we last asserted`
// — so every close needs a previous assertion to subtract from. Every close but
// the first one has one: the prior `posted` `month_end_inventory` row carries
// the balances resulting after itself. The FIRST close has nothing, and it must
// not invent one. It never assumes zero, and it never manufactures a synthetic
// `GlPosting` for an entry auxx.ai did not post. It reads this instead: the
// frozen December 31 physical count, valued at CPA-approved costs, that the
// accounting setup wizard (`plans/money/tasks/12-accounting-setup.md`) captured
// and finalized.
//
// This module owns the CONTRACT — the setting keys, the shape, and the read.
// The wizard that produces the values is task 12 and lives in `apps/web`.
//
// ## What this reader deliberately does NOT read
//
// The wizard also captures the accounting provider's own opening balances
// (`accounting.qboOpening*`) and the reference to the journal entry that booked
// them there (`accounting.qboOpeningJournalRef`). Those are PROVENANCE and a
// finalize-time GATE: the wizard shows the difference between the two snapshots
// and refuses to finalize until they agree, because a difference allowed to fall
// into January's balancing plug would classify a cutover problem as January
// COGS. Once that gate passes there is exactly one agreed set of balances, and
// it is the `accounting.opening*` set. The entry is valued from those. Reading
// the provider's copy here would be a second, unreconciled source of the same
// number.
//
// Likewise `accounting.setupFinalizedAt` / `…ByUserId`: audit metadata for the
// wizard, not inputs to the arithmetic.
//
// ## Everything here fails CLOSED
//
// There is no default, no zero and no UTC. Each refusal names the specific keys
// that are missing or wrong, because the repair is a person filling in a
// settings form and "the opening baseline is invalid" does not tell them which
// row. The alternative reading — substitute a plausible value and carry on —
// produces a journal entry that balances, claims cleanly, and is wrong by an
// amount nothing downstream can detect. That is the failure this whole module
// exists to refuse. Compare `resolvePeriodLock`, which makes the same call for
// the same reason.

import { err, ok, type Result } from 'neverthrow'
import { type AuxxErrorDetails, UnprocessableEntityError } from '../errors'
import { getOrganizationSetting } from '../settings/settings-service'
import { parsePeriodKey } from './periods'

/** The catalog keys this module reads. Nothing else in the read path names them. */
// Declared in `setup-readiness.ts` - the client-safe half - because the setup
// wizard needs these keys in a browser and this file reaches the database.
// Re-exported so every existing server importer is unaffected.
export { FINALIZED_SETUP_STATE, OPENING_BASELINE_SETTING_KEYS } from './setup-readiness'

import { FINALIZED_SETUP_STATE, OPENING_BASELINE_SETTING_KEYS } from './setup-readiness'

/**
 * The frozen opening position the first month-end entry is measured against.
 *
 * Every field is required. There is no partial baseline: a cutoff with no
 * timezone cannot derive a period key, and a timezone with no balances has
 * nothing to subtract from.
 */
export interface OpeningBaseline {
  /** The last month closed in the previous system, `'2026-12'`. Always a MONTH key. */
  cutoffPeriod: string
  /** The IANA zone period keys are derived in. Never defaulted to UTC. */
  bookTimeZone: string
  /**
   * Opening balances in integer minor units, keyed by the same account roles the
   * month-end entry asserts. `0` is a legitimate value and is NOT interchangeable
   * with "unset" — an organization with no work in process at cutover has exactly
   * zero WIP, and a reader that collapsed the two would silently value the first
   * entry against a baseline nobody supplied.
   */
  balances: {
    inventory_raw_materials: number
    inventory_wip: number
    inventory_finished_goods: number
  }
}

/**
 * Read and validate one organization's frozen opening baseline.
 *
 * ## Where the values come from: the org settings cache
 *
 * This reads the SAME cached path every other consumer of these settings uses.
 * `getOrganizationSetting` with no `db` argument answers from
 * `getOrgCache().get(orgId, 'orgSettings')` (`settings-service.ts:171-174`),
 * which already merges catalog defaults over the persisted org rows. There is no
 * transaction here and no row lock.
 *
 * ⚠️ Do NOT substitute `getAllOrganizationSettings`. Despite the name it never
 * takes the cached path — it always queries `OrganizationSetting` directly
 * (`settings-service.ts:187`). Six cached single-key reads are the cached path;
 * one "read them all" call is not.
 *
 * ### The cache is busted by the thing that writes it
 *
 * `apps/web/src/server/api/routers/setting.ts` fires
 * `onCacheEvent('org.settings.changed', { orgId, broadcastUserKeys: true })`
 * after BOTH write paths — the single-key `update` (line 134) and the batch
 * `batchUpdate` (line 221) — and `cache/invalidation-graph.ts:250` maps that
 * event to `org: ['orgSettings']`. So the accounting setup wizard, which posts
 * its values through those router mutations, drops this key on every save. The
 * baseline a close reads is the baseline the wizard last wrote.
 *
 * ### 🛑 The invalidation lives in the ROUTER, not in the settings service
 *
 * `updateOrganizationSetting` and `batchUpdateOrganizationSettings` fire NO
 * cache event of their own. Anything that writes one of these keys outside the
 * tRPC router — a script, a worker job, a seeder, a data migration — MUST fire
 * `onCacheEvent('org.settings.changed', { orgId })` itself or the org keeps
 * serving the pre-write value until the key's TTL expires. Existing non-router
 * writers already do exactly that: `settings/seed-document-business.ts:67` and
 * `getting-started/mutations.ts:42`. This is the one remaining way a stale
 * baseline can reach a close, and it is a bug in the writer, not here.
 *
 * ### Why the residual race is acceptable
 *
 * If a baseline did change underneath a close, the posted entry is still a
 * permanent record of what it was valued against: the month-end draft carries
 * `assertions.before` — the exact opening position it measured its delta from —
 * in its own envelope (`postings/draft.ts`). A later disagreement between that
 * snapshot and the current settings is therefore DISCOVERABLE by reading the
 * entry, not silently lost. The ledger is the audit trail; a row lock is not the
 * only thing that can provide one.
 *
 * And this was never a performance question either way: a close runs once a
 * month, per organization, behind a person clicking Post. Reading it the same
 * way everything else reads these settings is simply one fewer special case.
 *
 * ## What has NOT changed
 *
 * Everything below the read. No default, no `0`, no UTC, and every refusal names
 * the specific rows to fix. See the module header.
 *
 * @param organizationId The organization whose baseline is being read.
 * @returns The validated baseline, or an {@link UnprocessableEntityError} naming
 * exactly which keys are missing or unusable.
 */
export async function readOpeningBaseline(
  organizationId: string
): Promise<Result<OpeningBaseline, Error>> {
  const settings = await readSettings(organizationId)

  const K = OPENING_BASELINE_SETTING_KEYS

  // The setup gate first. A draft baseline is not a broken one — it is one
  // nobody has finished — and saying so is a different instruction to the
  // person reading the error than "cutoffPeriod is missing".
  const setupState = settings[K.setupState]
  if (setupState !== FINALIZED_SETUP_STATE) {
    return err(
      refusal(
        organizationId,
        `Accounting setup for this organization is not finalized (${K.setupState} is ` +
          `${describe(setupState)}, expected "${FINALIZED_SETUP_STATE}"). Complete the ` +
          'accounting setup before posting. Posting is refused until it is finalized.',
        { setting: K.setupState, value: describe(setupState) }
      )
    )
  }

  // Then everything that is simply absent, in ONE message. A wizard that was
  // half-filled is missing several rows and reporting them one refusal at a time
  // makes the repair take as many attempts as there are blank fields.
  const missing = (
    [
      K.cutoffPeriod,
      K.bookTimeZone,
      K.inventory_raw_materials,
      K.inventory_wip,
      K.inventory_finished_goods,
    ] as const
  ).filter((key) => isUnset(settings[key]))

  if (missing.length > 0) {
    return err(
      refusal(
        organizationId,
        `The accounting opening baseline for this organization is incomplete. Missing: ` +
          `${missing.join(', ')}. Set these in accounting setup. There is no default — an ` +
          'unset opening balance is not zero, and posting against a guess would value a ' +
          'journal entry that nothing downstream can check.',
        { missing }
      )
    )
  }

  const cutoffPeriod = validateCutoffPeriod(settings[K.cutoffPeriod])
  if (typeof cutoffPeriod !== 'string') {
    return err(refusal(organizationId, cutoffPeriod.message, cutoffPeriod.meta))
  }

  const bookTimeZone = validateTimeZone(settings[K.bookTimeZone])
  if (typeof bookTimeZone !== 'string') {
    return err(refusal(organizationId, bookTimeZone.message, bookTimeZone.meta))
  }

  const roles = ['inventory_raw_materials', 'inventory_wip', 'inventory_finished_goods'] as const
  const balances = {} as OpeningBaseline['balances']
  for (const role of roles) {
    const amount = validateMinorUnits(K[role], settings[K[role]])
    if (typeof amount !== 'number') {
      return err(refusal(organizationId, amount.message, amount.meta))
    }
    balances[role] = amount
  }

  return ok({ cutoffPeriod, bookTimeZone, balances })
}

// ── The read ───────────────────────────────────────────────────────────────

/**
 * The six catalog keys, one cached lookup each.
 *
 * 🛑 No `db` argument, deliberately. `getOrganizationSetting` only answers from
 * `getOrgCache().get(orgId, 'orgSettings')` when `db` is omitted; supplying one
 * — a `Database` or a `Transaction` — switches it to a direct
 * `OrganizationSetting` query (`settings-service.ts:156-169`). So the ABSENCE of
 * that argument is what makes this the cached path, which is exactly the kind of
 * thing a later refactor adds back without noticing. The test asserts it.
 *
 * The cache map already merges catalog defaults over the persisted rows, and the
 * defaults for five of these six keys are `null` — which is what every
 * fail-closed check below is written against. `accounting.setupState` defaults to
 * `'draft'`, which the setup gate refuses.
 */
async function readSettings(organizationId: string): Promise<Record<string, unknown>> {
  const keys = Object.values(OPENING_BASELINE_SETTING_KEYS)
  const values = await Promise.all(
    keys.map((key) => getOrganizationSetting({ organizationId, key }))
  )
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]))
}

// ── Validation ─────────────────────────────────────────────────────────────

/** A validation failure carrying the message and metadata its refusal needs. */
interface Invalid {
  message: string
  meta: AuxxErrorDetails
}

/**
 * Unset, cleared, or whitespace. A settings form that clears a text input writes
 * `''` rather than deleting the row, so both spellings of "nobody filled this
 * in" have to land in the same place — and `0` is emphatically NOT one of them.
 */
function isUnset(value: unknown): boolean {
  if (value == null) return true
  return typeof value === 'string' && value.trim().length === 0
}

/**
 * The cutoff must be a MONTH key. `parsePeriodKey` owns the keyspace so the
 * pattern is not duplicated here, but it also accepts a DAY key, which this
 * setting must not: the cutoff divides "covered by the opening balances" from
 * "valued by the subledger", and that boundary is a month boundary. Silently
 * picking one edge of a day key is the fail-open reading in a different costume.
 */
function validateCutoffPeriod(raw: unknown): string | Invalid {
  const key = OPENING_BASELINE_SETTING_KEYS.cutoffPeriod
  if (typeof raw !== 'string') {
    return {
      message:
        `The accounting cutoff period for this organization is not a month: ${describe(raw)}. ` +
        `Set ${key} to a YYYY-MM month.`,
      meta: { setting: key, value: describe(raw) },
    }
  }

  const trimmed = raw.trim()
  let granularity: string
  try {
    granularity = parsePeriodKey(trimmed).granularity
  } catch {
    return {
      message:
        `The accounting cutoff period for this organization is not a valid month: ` +
        `"${trimmed}". Set ${key} to a YYYY-MM month.`,
      meta: { setting: key, value: trimmed },
    }
  }

  if (granularity !== 'month') {
    return {
      message:
        `The accounting cutoff period for this organization is a date, not a month: ` +
        `"${trimmed}". The cutoff divides accounting months. Set ${key} to YYYY-MM.`,
      meta: { setting: key, value: trimmed },
    }
  }

  return trimmed
}

/**
 * The book timezone must be a real IANA zone.
 *
 * There is no allowlist to check against and no zone database in the runtime we
 * can enumerate, so the validation is the one the platform already performs:
 * `Intl.DateTimeFormat` throws `RangeError` on an unrecognised `timeZone`. That
 * is exactly the call `periodKeyForDate` will make later, so validating with it
 * here means a value that passes cannot fail there.
 *
 * 🛑 No UTC fallback. `periodKeyForDate` defaults to UTC because its callers
 * have already normalized; this value IS the normalization. A receipt logged at
 * 7pm on January 31 in `America/New_York` is already February 1 in UTC, so an
 * assumed zone posts a month's edge activity into the wrong period — invisible
 * except at a close, and uncorrectable once the period is locked.
 */
function validateTimeZone(raw: unknown): string | Invalid {
  const key = OPENING_BASELINE_SETTING_KEYS.bookTimeZone
  if (typeof raw !== 'string') {
    return {
      message:
        `The book timezone for this organization is not a timezone name: ${describe(raw)}. ` +
        `Set ${key} to an IANA zone such as America/New_York.`,
      meta: { setting: key, value: describe(raw) },
    }
  }

  const trimmed = raw.trim()
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmed })
  } catch {
    return {
      message:
        `The book timezone for this organization is not a recognised IANA zone: ` +
        `"${trimmed}". Set ${key} to a zone such as America/New_York. Periods are refused ` +
        'rather than derived in UTC, because a wrong zone posts month-edge activity into ' +
        'the wrong month.',
      meta: { setting: key, value: trimmed },
    }
  }

  return trimmed
}

/**
 * An opening balance is an integer count of minor units.
 *
 * The catalog cannot enforce this: `normalizeSettingValue` routes `CURRENCY`
 * through `fieldValueSchemas.number`, which rejects only a non-finite number, so
 * `12.5` reaches storage happily. A fractional cent then propagates into a
 * posted entry's line amounts, where it is either silently rounded by whoever
 * touches it next or breaks the balance assertion in a way that points at the
 * wrong module. Refusing here is a one-row repair.
 */
function validateMinorUnits(key: string, raw: unknown): number | Invalid {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return {
      message:
        `The opening balance ${key} for this organization is not a number: ${describe(raw)}. ` +
        'Set it to an amount in integer minor units.',
      meta: { setting: key, value: describe(raw) },
    }
  }

  if (!Number.isInteger(raw)) {
    return {
      message:
        `The opening balance ${key} for this organization is ${raw}, which is not a whole ` +
        'number of minor units. Opening balances are integer minor units (cents), not ' +
        'fractional currency.',
      meta: { setting: key, value: describe(raw) },
    }
  }

  return raw
}

// ── Helpers ────────────────────────────────────────────────────────────────

function refusal(
  organizationId: string,
  message: string,
  meta: AuxxErrorDetails
): UnprocessableEntityError {
  return new UnprocessableEntityError(message, { organizationId, ...meta })
}

/** A stored value, described for an error message without dumping a blob into it. */
function describe(value: unknown): string {
  if (value === null) return 'unset'
  if (value === undefined) return 'unset'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `a ${Array.isArray(value) ? 'list' : typeof value}`
}
