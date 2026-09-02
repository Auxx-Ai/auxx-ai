// packages/lib/src/bom/resync-tariff-starters.ts

/**
 * Re-syncing a `tariff_code` the org ALREADY holds with the starter catalogue
 * (plans/money/tasks/35-tariff-catalogue-resync.md).
 *
 * `adopt-tariff-starters.ts` writes a code's rate history once, at adoption, and
 * is idempotent BY SKIP - a pair the org already holds "is skipped whole and
 * reported. Never updated, never topped up." So a catalogue correction never
 * reaches an org that already adopted. This module is the other half: it
 * re-expands the catalogue for a code the org holds, diffs the result against
 * the stored rows, and appends what is missing.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🛑 THE FAILURE THIS IS DESIGNED AROUND (35 §1)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `resolveTariffRate` groups rows by `authorityKey(row.authority)` - a case- and
 * whitespace-FOLDED string - takes the latest `effectiveFrom <= today` per
 * group, and then **SUMS across groups**.
 *
 * So the naive top-up is lethal. An org that renamed `IEEPA fentanyl` to
 * `IEEPA` gets a new step appended under OUR spelling, which lands in a SECOND
 * authority group, and the two now sum. The rate silently doubles. No error, no
 * warning, and the "no base rate" check does not fire because the base row is
 * intact.
 *
 * The three rules that follow from that, and which this file exists to keep:
 *
 *  1. **INSERT only. Never update, never archive.** Right on the merits, not
 *     merely cautious: the model already says an expiry is "an explicit `0`, and
 *     there is no end date", so a withdrawn action is a new dated `0` step, not
 *     a deletion. Append covers rate changes, brand-new actions, membership
 *     corrections and expiries - everything except "we wrote it wrong", which is
 *     out of scope by decision (35 §3.2) and corrected by hand in the editor.
 *  2. **Pair the action on `chapter99Code`, the step on `effectiveFrom`. NEVER
 *     on `authority`.** `chapter99Code` is the government's own identifier for
 *     an action, it is on every action row, it is `null` on exactly the MFN base
 *     row, and an org has no reason to edit it. So `(chapter99Code,
 *     effectiveFrom)` is a natural key for a catalogue-written row with no
 *     schema change at all.
 *  3. **A new step is written with the ORG's authority spelling for THAT code**,
 *     read off the sibling rows on that same code sharing that `chapter99Code`.
 *
 * 🛑 **Rule 3 is resolved PER CODE, never once per action** (35 §3.1). One click
 * applies an action across every code it touches, so an action-scoped apply over
 * twelve codes is twelve chances to double-count. Resolving the spelling once
 * for the action and reusing it is rule 2's bug wearing a different hat, and it
 * will not show up in a test that uses one code.
 *
 * ⚠️ "No sibling" is the common case, not an edge: a code that has never carried
 * a Section 301 row has nothing to copy a spelling from, and the catalogue's own
 * is used. Rule 3 therefore protects only codes that ALREADY carry the
 * authority. A code gaining an authority for the first time is unprotected by
 * construction, and that is correct - there is nothing to collide with.
 *
 * ⚠️ The residual hole, stated so nobody rediscovers it as a surprise: an org
 * that BLANKED a row's `chapter99Code` (it is display-only, §2 of task 29) has
 * hidden that row from the sibling lookup. If they also renamed its authority,
 * the appended step lands in a second group. There is no defence against that
 * short of per-row provenance, which 35 §3.2 rules out until `9903.91`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * NO VERSION COMPARISON (35 §4)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This never asks "is the catalogue newer than what this org has". It re-runs
 * `expandTariffStarter` for the `(code, country)` and diffs it against the
 * stored rows - pure, in memory, one expansion per code. That removes a bug
 * class as well as being simpler: `TARIFF_STARTERS_VERSION` is a bare date and
 * one date already covers materially different catalogues. The version stays
 * provenance on the row and stops being a decision input.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE TRANSACTION UNIT IS ONE CODE (35 §5.1)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Not the action. `UnifiedCrudHandler` takes a `Database`, not a `Transaction`,
 * so each code's writes go in their own `db.transaction` with the
 * `tx as unknown as Database` cast `adopt-tariff-starters.ts` already uses.
 * Whole-or-nothing PER CODE - a code that gains three of four rows is 29 §3's
 * silent understatement again - and codes are written sequentially, in order.
 *
 * 🛑 So an action apply can PARTIALLY COMPLETE, and says so.
 * {@link ResyncApplyResult} carries `applied`, `failed` and `remaining`, and a
 * partial run still returns `ok` - erring would throw away the record of what
 * was already committed. Never report "done" for a run that stopped at code 137
 * of 200.
 *
 * No permission checks: the router asserts `tariff_code` and `tariff_rate` edit
 * before calling this (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { AuxxError, BadRequestError, NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud'
import { loadTariffMemberships } from './tariff-301-memberships'
import { findHtsGeneral, loadHtsGeneral } from './tariff-hts-general'
import { loadTariffSchedule, readBookTimeZone } from './tariff-schedule'
import {
  expandTariffStarter,
  type StarterAction,
  TARIFF_ACTIONS,
  TARIFF_STARTERS_VERSION,
} from './tariff-starters'
import { authorityKey, effectiveDay, resolveTariffRate, type TariffRateRow } from './vendor-cost'

const logger = createScopedLogger('bom:resync-tariff-starters')

/**
 * The pseudo-action the MFN base row is grouped under.
 *
 * ⚠️ A DEVIATION from 35 §5, which typed `ResyncAction.chapter99Code` as a bare
 * `string`. The base row is `(null, 1995-01-01)` by §2's own account, so it is
 * part of the natural keyspace this module diffs on, and a code typed by hand
 * before the catalogue existed can be missing it entirely - which is exactly
 * 29 §3's silent understatement. Excluding it would have left the one addition
 * that fixes that case unreachable. So `actionKey`/`authority`/`chapter99Code`
 * admit the base row, and it is its own row in the dialog rather than being
 * folded into a government action it is not.
 *
 * Appending it is safe under the resolution rule even when the org already has
 * a base row at a later date: `1995-01-01` loses that group's latest-wins
 * comparison and contributes nothing.
 */
export const MFN_ACTION_KEY = 'mfn'

/** One row the catalogue would add to a code that already holds it. */
export interface ResyncAddition {
  /** A PERCENTAGE - `25` means 25%. */
  rate: number
  /** `YYYY-MM-DD`. */
  effectiveFrom: string
  /** This CODE's spelling where it already carries the authority; ours otherwise. §3.1 */
  authority: string | null
  chapter99Code: string | null
  note: string
  /**
   * True when the spelling came from a sibling row rather than the catalogue.
   *
   * Rendered, not hidden: rule 3 doing its job should be visible. The dialog
   * only says so when the sibling's spelling actually DIFFERS from the
   * catalogue's, because "used your spelling, which is our spelling" is noise.
   */
  spellingFromOrg: boolean
}

/** One code an action would add rows to, with what it resolves to before and after. */
export interface ResyncCode {
  codeInstanceId: string
  code: string
  country: string
  /** Oldest `effectiveFrom` first. */
  additions: ResyncAddition[]
  /** Resolved total today, before and after THIS action's additions. What a person consents to. */
  before: number
  after: number
}

/** The unit of apply: one government action, across every code it touches. */
export interface ResyncAction {
  /** A key into `TARIFF_ACTIONS`, or {@link MFN_ACTION_KEY}. */
  actionKey: string
  /** The CATALOGUE's spelling. `null` for the base row, which has no authority. */
  authority: string | null
  /** `null` for the base row - see {@link MFN_ACTION_KEY}. */
  chapter99Code: string | null
  /** Sorted by the largest swing first, so the biggest change reads first (§7.1). */
  codes: ResyncCode[]
}

/** One stored row whose rate disagrees with the catalogue at the same day. */
export interface ResyncDivergence {
  codeInstanceId: string
  code: string
  /** The `tariff_rate` instance id, so the editor can be pointed at it. */
  rateId: string
  chapter99Code: string | null
  effectiveFrom: string
  /** What the org holds. */
  ours: number
  /** What the catalogue says. */
  theirs: number
}

export interface ResyncPlan {
  /** Most codes affected first. */
  actions: ResyncAction[]
  /**
   * Rows the org holds whose rate differs from the catalogue at the same
   * `effectiveFrom`. REPORTED ONLY - never written (§3.2). An org that set
   * List 3 to 30% meant it, and this module does not argue.
   */
  diverged: ResyncDivergence[]
  /** Stamped so "nothing to apply" can say WHICH catalogue said so (§7.3). */
  version: string
}

/** What one apply did. A partial run is `ok` and reports all three lists. */
export interface ResyncApplyResult {
  actionKey: string
  /** Codes written whole, in the order they were written. */
  applied: Array<{ codeInstanceId: string; code: string; rows: number }>
  /** The code the run stopped on. At most one - writing is sequential and aborts. */
  failed: Array<{ codeInstanceId: string; code: string; error: string }>
  /** Codes never attempted, because a failure stopped the run before them. */
  remaining: Array<{ codeInstanceId: string; code: string }>
}

/**
 * Test-only overrides, mirroring `expandTariffStarter`'s own `deps` seam.
 * Production callers omit this.
 */
export interface ResyncDeps {
  /** Override the hand-kept action table. */
  actions?: Record<string, StarterAction>
  /** Override the version stamped into the note of every row written. */
  version?: string
  /** The instant `before` / `after` resolve at. Defaults to now. */
  now?: Date
}

/** One `tariff_code` record, reduced to what the diff needs. */
interface CodeRow {
  instanceId: string
  code: string
  country: string
}

/** `(chapter99Code, day)` - the natural key of a catalogue-written row (§2). */
function rowKey(chapter99Code: string | null, day: string): string {
  return `${(chapter99Code ?? '').trim()}|${day}`
}

/** The heading as a lookup key. Trimmed only: it is digits and dots, never prose. */
function headingKey(chapter99Code: string | null): string {
  return (chapter99Code ?? '').trim()
}

const emptyPlan = (version: string): ResyncPlan => ({ actions: [], diverged: [], version })

/**
 * Every LIVE `tariff_code` in the org with its code and country.
 *
 * 🛑 Archived codes are excluded, matching adopt's rule 1: archiving was a
 * decision, and a sync that quietly appended rows to a code somebody
 * soft-deleted would be undoing it. This is the OPPOSITE call from
 * `loadExistingPairKeys` in `adopt-tariff-starters.ts`, which includes archived
 * rows on purpose - there the question is "did the org ever adopt this", here it
 * is "is this code live".
 */
async function loadTariffCodeRows(
  db: Database,
  organizationId: string,
  tariffCodeDefId: string,
  codeInstanceIds?: readonly string[]
): Promise<CodeRow[]> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['tariff_code_code', 'tariff_code_country'] as const)
  const codeField = fields.tariff_code_code
  const countryField = fields.tariff_code_country
  if (!codeField || !countryField) return []

  const codeValue = alias(schema.FieldValue, 'resync_tariff_code_code')
  const countryValue = alias(schema.FieldValue, 'resync_tariff_code_country')

  const rows = await db
    .select({
      instanceId: schema.EntityInstance.id,
      code: codeValue.valueText,
      country: countryValue.optionId,
    })
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
        eq(schema.EntityInstance.entityDefinitionId, tariffCodeDefId),
        isNull(schema.EntityInstance.archivedAt),
        ...(codeInstanceIds ? [inArray(schema.EntityInstance.id, [...codeInstanceIds])] : [])
      )
    )

  const result: CodeRow[] = []
  for (const row of rows) {
    // A code with no origin cannot be expanded - the whole catalogue is
    // `(code, country)` - so it has nothing to sync and is not an error.
    if (row.code && row.country) {
      result.push({ instanceId: row.instanceId, code: row.code, country: row.country })
    }
  }
  return result
}

/**
 * This CODE's own spelling of the authority on each Chapter 99 heading it
 * carries - rule 3, and the whole point of resolving it per code (§3.1).
 *
 * The latest row wins where a code carries several steps of the same action,
 * because that is the spelling in force; ties break on the instance id so the
 * answer is total. A code that carries no row for a heading is simply absent
 * from the map, and the caller falls back to the catalogue's spelling.
 */
function orgAuthorityByHeading(rows: readonly TariffRateRow[]): Map<string, string | null> {
  const best = new Map<string, { authority: string | null; day: string; id: string }>()
  for (const row of rows) {
    const heading = headingKey(row.chapter99Code)
    if (heading === '') continue
    const day = effectiveDay(row.effectiveFrom) ?? ''
    const held = best.get(heading)
    if (!held || day > held.day || (day === held.day && row.id > held.id)) {
      best.set(heading, { authority: row.authority, day, id: row.id })
    }
  }
  return new Map([...best].map(([heading, entry]) => [heading, entry.authority]))
}

/**
 * The additions turned into rows the resolver can read, so `before` and `after`
 * come out of the SAME function that prices a receipt.
 *
 * 🛑 The synthesised ids start with `~` deliberately. `resolveTariffRate` breaks
 * a same-day tie inside an authority group on `row.id`, and ids in this system
 * are alphanumeric, so `~` sorts after every real one and a pending row wins a
 * tie against a stored row rather than losing it silently. That is the honest
 * preview: the row being added is the newer one.
 */
function additionsAsRows(additions: readonly ResyncAddition[]): TariffRateRow[] {
  return additions.map((addition, index) => ({
    id: `~resync:${index}`,
    authority: addition.authority,
    rate: addition.rate,
    effectiveFrom: addition.effectiveFrom,
    chapter99Code: addition.chapter99Code,
  }))
}

/**
 * What the catalogue would add to every live `tariff_code` in the org, grouped
 * by the government action that would add it.
 *
 * Reads only. `codeInstanceIds` narrows it to the codes named - the per-row
 * button's "fix this one code" (§7.2) - and is the same narrowing
 * {@link applyTariffResync} re-derives with.
 *
 * The schedule is read through `loadTariffSchedule`, which deliberately has no
 * org-cache key (29 §7) and therefore cannot serve a stale schedule into a diff
 * that decides what to write.
 */
export async function planTariffResync(
  db: Database,
  organizationId: string,
  codeInstanceIds?: readonly string[],
  deps?: ResyncDeps
): Promise<Result<ResyncPlan, Error>> {
  const actions = deps?.actions ?? (TARIFF_ACTIONS as Record<string, StarterAction>)
  const version = deps?.version ?? TARIFF_STARTERS_VERSION

  if (codeInstanceIds && codeInstanceIds.length === 0) return ok(emptyPlan(version))

  const [tariffCodeDefId, tariffRateDefId] = await Promise.all([
    getCachedEntityDefId(organizationId, 'tariff_code'),
    getCachedEntityDefId(organizationId, 'tariff_rate'),
  ])
  if (!tariffCodeDefId || !tariffRateDefId) {
    return err(
      new NotFoundError(
        'This org has no tariff_code / tariff_rate definitions yet - nothing to re-sync'
      )
    )
  }

  const codes = await loadTariffCodeRows(db, organizationId, tariffCodeDefId, codeInstanceIds)
  if (codes.length === 0) return ok(emptyPlan(version))

  const [schedule, catalogue, memberships, timeZone] = await Promise.all([
    loadTariffSchedule(
      db,
      organizationId,
      codes.map((code) => code.instanceId)
    ),
    loadHtsGeneral(),
    loadTariffMemberships(),
    readBookTimeZone(organizationId),
  ])
  const now = deps?.now ?? new Date()

  // `(country, heading)` identifies an action: a `StarterAction` carries exactly
  // one of each, and the same heading under two origins is two actions.
  const actionKeyByCountryHeading = new Map<string, string>()
  for (const [key, action] of Object.entries(actions)) {
    actionKeyByCountryHeading.set(`${action.country}|${headingKey(action.chapter99Code)}`, key)
  }

  const diverged: ResyncDivergence[] = []
  const grouped = new Map<string, ResyncAction>()

  for (const code of codes) {
    const line = findHtsGeneral(catalogue.lines, code.code)
    // A code the catalogue does not carry - hand-typed, or a heading we have no
    // general rate for - produces no additions. Nothing has to ask "did we
    // write this row".
    if (!line) continue

    const expansion = expandTariffStarter(line, code.country, memberships, { actions, version })
    const stored = schedule.get(code.instanceId) ?? []

    const storedByKey = new Map<string, TariffRateRow>()
    for (const row of stored) {
      const day = effectiveDay(row.effectiveFrom)
      if (day === null) continue
      const key = rowKey(row.chapter99Code, day)
      // First wins. A code holding two rows at the same `(heading, day)` is
      // already ambiguous; picking one deterministically beats planning an
      // addition against the second and writing a third.
      if (!storedByKey.has(key)) storedByKey.set(key, row)
    }

    // 🛑 Rule 3, resolved from THIS CODE's own rows and used only for this code.
    const authorityByHeading = orgAuthorityByHeading(stored)

    /** The additions this code would take, split by the action that brings them. */
    const byAction = new Map<string, ResyncAddition[]>()

    for (const row of expansion.rows) {
      const key = rowKey(row.chapter99Code, row.effectiveFrom)
      const held = storedByKey.get(key)
      if (held) {
        if ((held.rate ?? 0) !== row.rate) {
          diverged.push({
            codeInstanceId: code.instanceId,
            code: code.code,
            rateId: held.id,
            chapter99Code: row.chapter99Code,
            effectiveFrom: row.effectiveFrom,
            ours: held.rate ?? 0,
            theirs: row.rate,
          })
        }
        continue
      }

      const heading = headingKey(row.chapter99Code)
      const hasSibling = authorityByHeading.has(heading)
      const authority = hasSibling ? (authorityByHeading.get(heading) ?? null) : row.authority
      const actionKey =
        heading === ''
          ? MFN_ACTION_KEY
          : (actionKeyByCountryHeading.get(`${code.country}|${heading}`) ?? heading)

      const bucket = byAction.get(actionKey) ?? []
      bucket.push({
        rate: row.rate,
        effectiveFrom: row.effectiveFrom,
        authority,
        chapter99Code: row.chapter99Code,
        note: row.note,
        // Folded, not compared raw: `IEEPA` and `ieepa ` are the same authority
        // to the resolver, so they are the same spelling here too.
        spellingFromOrg: hasSibling && authorityKey(authority) !== authorityKey(row.authority),
      })
      byAction.set(actionKey, bucket)
    }

    for (const [actionKey, additions] of byAction) {
      additions.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))

      // ONE resolver, over current rows and then over current + this action's
      // additions - the same rule the Codes list and the picker preview render
      // with. `before` and `after` are per action because apply is per action.
      const before = resolveTariffRate(stored, now, timeZone).rate
      const after = resolveTariffRate(
        [...stored, ...additionsAsRows(additions)],
        now,
        timeZone
      ).rate

      const action = actions[actionKey]
      let entry = grouped.get(actionKey)
      if (!entry) {
        entry = {
          actionKey,
          authority: actionKey === MFN_ACTION_KEY ? null : (action?.authority ?? null),
          chapter99Code: actionKey === MFN_ACTION_KEY ? null : (action?.chapter99Code ?? actionKey),
          codes: [],
        }
        grouped.set(actionKey, entry)
      }
      entry.codes.push({
        codeInstanceId: code.instanceId,
        code: code.code,
        country: code.country,
        additions,
        before,
        after,
      })
    }
  }

  const plan: ResyncPlan = {
    actions: [...grouped.values()],
    diverged,
    version,
  }

  // Largest swing first inside an action (§7.1), most codes affected first
  // across actions. Both ties break on a string so the order is total and the
  // dialog does not reshuffle between renders.
  for (const action of plan.actions) {
    action.codes.sort((a, b) => {
      const swing = Math.abs(b.after - b.before) - Math.abs(a.after - a.before)
      return swing !== 0 ? swing : a.code.localeCompare(b.code)
    })
  }
  plan.actions.sort((a, b) => {
    const size = b.codes.length - a.codes.length
    return size !== 0 ? size : a.actionKey.localeCompare(b.actionKey)
  })

  return ok(plan)
}

/**
 * Writes one code's additions inside one transaction. Throws (rolling back all
 * of them) on any failure; the caller decides what that means for the run.
 */
async function appendRows(
  db: Database,
  organizationId: string,
  userId: string,
  tariffRateDefId: string,
  codeInstanceId: string,
  additions: readonly ResyncAddition[]
): Promise<void> {
  await db.transaction(async (tx) => {
    // See the file header: `UnifiedCrudHandler` takes a `Database`, not a
    // `Transaction` - the same cast `adopt-tariff-starters.ts` makes.
    const txDb = tx as unknown as Database
    const handler = new UnifiedCrudHandler(organizationId, userId, txDb)
    const codeRecordId = `tariff_code:${codeInstanceId}`

    for (const addition of additions) {
      await handler.create(tariffRateDefId, {
        tariff_rate_tariff_code: codeRecordId,
        tariff_rate_rate: addition.rate,
        tariff_rate_effective_from: `${addition.effectiveFrom}T00:00:00.000Z`,
        ...(addition.authority ? { tariff_rate_authority: addition.authority } : {}),
        ...(addition.chapter99Code ? { tariff_rate_chapter99_code: addition.chapter99Code } : {}),
        tariff_rate_note: addition.note,
      })
    }
  })
}

/**
 * Applies ONE government action across the codes named, appending the rows the
 * catalogue would add and touching nothing else.
 *
 * 🛑 **Re-derives the plan inside the call** rather than trusting one posted
 * from the browser. The dialog's plan is for display; the write re-computes.
 * Otherwise a plan computed before somebody edited a rate applies against a
 * schedule that has moved - and re-deriving is also what makes a double click,
 * or two people pressing the button at once, insert nothing the second time.
 *
 * Codes are written sequentially in the order the caller named them, one
 * transaction each. A failure STOPS the run: what committed stays committed,
 * what was never attempted is reported as `remaining`, and the result is `ok`
 * so the caller can render all three lists (§5.1).
 */
export async function applyTariffResync(
  db: Database,
  organizationId: string,
  userId: string,
  input: { actionKey: string; codeInstanceIds: readonly string[] },
  deps?: ResyncDeps
): Promise<Result<ResyncApplyResult, Error>> {
  if (input.codeInstanceIds.length === 0) {
    return err(new BadRequestError('Name at least one tariff code to re-sync'))
  }

  const tariffRateDefId = await getCachedEntityDefId(organizationId, 'tariff_rate')
  if (!tariffRateDefId) {
    return err(new NotFoundError('This org has no tariff_rate definition yet - nothing to write'))
  }

  const planned = await planTariffResync(db, organizationId, input.codeInstanceIds, deps)
  if (planned.isErr()) return err(planned.error)

  const empty: ResyncApplyResult = {
    actionKey: input.actionKey,
    applied: [],
    failed: [],
    remaining: [],
  }

  const action = planned.value.actions.find((entry) => entry.actionKey === input.actionKey)
  // Not an error: the re-derived plan says there is nothing left to add. That is
  // the answer when the rows already landed - a second click, a second tab.
  if (!action) return ok(empty)

  // The caller's order, not the plan's - `codeInstanceIds` is what a person
  // picked, and a partial run has to be describable against that list.
  const byInstance = new Map(action.codes.map((entry) => [entry.codeInstanceId, entry]))
  const queue = input.codeInstanceIds
    .map((id) => byInstance.get(id))
    .filter((entry): entry is ResyncCode => entry !== undefined)

  const result: ResyncApplyResult = { ...empty }

  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index] as ResyncCode
    try {
      await appendRows(
        db,
        organizationId,
        userId,
        tariffRateDefId,
        entry.codeInstanceId,
        entry.additions
      )
      result.applied.push({
        codeInstanceId: entry.codeInstanceId,
        code: entry.code,
        rows: entry.additions.length,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to re-sync a tariff code with the catalogue', {
        organizationId,
        actionKey: input.actionKey,
        codeInstanceId: entry.codeInstanceId,
        code: entry.code,
        error,
      })
      result.failed.push({
        codeInstanceId: entry.codeInstanceId,
        code: entry.code,
        error: error instanceof AuxxError ? error.message : message,
      })
      result.remaining = queue
        .slice(index + 1)
        .map((rest) => ({ codeInstanceId: rest.codeInstanceId, code: rest.code }))
      break
    }
  }

  logger.info('Re-synced tariff codes with the catalogue', {
    organizationId,
    actionKey: input.actionKey,
    applied: result.applied.length,
    failed: result.failed.length,
    remaining: result.remaining.length,
  })

  return ok(result)
}
