// packages/lib/src/postings/provider-sync/range.ts
//
// Where the sync may read, and how the range is walked.
//
// PURE. No database, no provider, no clock - the caller supplies "today", so
// the cutover floor is testable without one.
//
// 🛑🛑 **THE CUTOVER FLOOR IS THE SECOND OF THE TWO WAYS THIS FEATURE CAN
// DOUBLE A LEDGER.** Brief 19's opening entry IS the provider's own pre-cutover
// position, restated as one entry of ours. Reading back the period it
// summarises imports the very balances it was derived from and doubles the
// entire opening position - and like the exclusion in `plan.ts`, both copies
// balance, every statement still ties, and nothing downstream can detect it.
//
// So the floor is ASSERTED BEFORE THE CALL, never applied as a filter after.
// A filter is a place where a later "fix a bug in the filter" edit silently
// widens the range; a refusal is a place where it cannot.
//
// @see plans/accounting/tasks/20-two-authors-one-ledger.md §5.4, §11.3, §12.11

import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type { ProviderSyncRange } from './client'

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The earliest date the sync may ever read: the first day of the month AFTER
 * `accounting.cutoffPeriod`.
 *
 * `cutoffPeriod` is the last month the OLD system owned, and the opening entry
 * is dated its last day (`cutoverDateFor`). So everything up to and including
 * that day is already in our books, once, as one entry - and is off limits.
 *
 * @throws never. Returns `err` on a `cutoffPeriod` that is not a real `YYYY-MM`.
 */
export function providerSyncFloor(cutoffPeriod: string): Result<string, Error> {
  const match = MONTH_PATTERN.exec(cutoffPeriod)
  if (!match) {
    return err(
      new UnprocessableEntityError(
        `The accounting cutoff is "${cutoffPeriod}", which is not a YYYY-MM month. The provider ` +
          'sync reads from the month after the cutoff onward and cannot place its floor without ' +
          'one.',
        { cutoffPeriod }
      )
    )
  }
  const year = Number(match[1]!)
  const month = Number(match[2]!)
  if (month < 1 || month > 12) {
    return err(
      new UnprocessableEntityError(
        `The accounting cutoff is "${cutoffPeriod}", whose month is not 1-12.`,
        { cutoffPeriod }
      )
    )
  }
  return ok(month === 12 ? `${pad4(year + 1)}-01-01` : `${pad4(year)}-${pad2(month + 1)}-01`)
}

export interface PlanSyncChunksInput {
  /** `accounting.cutoffPeriod`, `YYYY-MM`. The last month the OLD system owned. */
  cutoffPeriod: string
  /**
   * The first date to read, `YYYY-MM-DD`. Omit for "everything the sync is
   * allowed to see", which is {@link providerSyncFloor}.
   *
   * 🛑 A value BELOW the floor is a refusal naming both dates, never a clamp.
   * Clamping would let a caller ask for the opening period and be told nothing.
   */
  from?: string
  /** The last date to read, `YYYY-MM-DD`, inclusive. Usually today in the book timezone. */
  to: string
}

/**
 * Split a request into the month-sized chunks the sync actually issues, after
 * asserting the cutover floor.
 *
 * **Why a month.** §4.8 established by experiment that report endpoints do not
 * paginate - Intuit accepts `startposition` and `maxresults` and silently
 * ignores them - so the date range is the only lever there is. A month is
 * chosen over a wider range because the residual risk is silent truncation and
 * 🛑 **a truncated chunk is indistinguishable from a quiet month.** Chunk size
 * is a safety property here, not a performance knob. Narrower is always safe;
 * wider is a bet on an undocumented cap nobody has measured (§11.2 records why
 * nobody will measure it before this ships).
 *
 * The first and last chunks are clipped to `from` and `to`; every chunk in
 * between is a whole calendar month.
 *
 * @returns `err` when the cutoff is unparseable, when `from` is before the
 *   floor, when either date is not `YYYY-MM-DD`, or when `to` is before `from`.
 *   An empty array is impossible: a valid range always yields at least one
 *   chunk.
 */
export function planSyncChunks(input: PlanSyncChunksInput): Result<ProviderSyncRange[], Error> {
  const floor = providerSyncFloor(input.cutoffPeriod)
  if (floor.isErr()) return err(floor.error)

  const from = input.from ?? floor.value
  if (!DAY_PATTERN.test(from)) {
    return err(
      new UnprocessableEntityError(`The sync's start date "${from}" is not a YYYY-MM-DD date.`, {
        from,
      })
    )
  }
  if (!DAY_PATTERN.test(input.to)) {
    return err(
      new UnprocessableEntityError(`The sync's end date "${input.to}" is not a YYYY-MM-DD date.`, {
        to: input.to,
      })
    )
  }

  // 🛑 THE FLOOR. Asserted here, before anything is fetched.
  if (from < floor.value) {
    return err(
      new UnprocessableEntityError(
        `The provider sync cannot read before ${floor.value}. The accounting cutoff is ` +
          `${input.cutoffPeriod}, and everything up to the end of that month is already in the ` +
          "books as the single opening entry - which was derived from the provider's own " +
          `balances. Reading ${from} back would import those balances a second time and double ` +
          'the whole opening position.',
        { from, floor: floor.value, cutoffPeriod: input.cutoffPeriod }
      )
    )
  }

  if (input.to < from) {
    return err(
      new UnprocessableEntityError(
        `The sync's end date ${input.to} is before its start date ${from}.`,
        { from, to: input.to }
      )
    )
  }

  const chunks: ProviderSyncRange[] = []
  let cursor = from
  while (cursor <= input.to) {
    const monthEnd = endOfMonth(cursor)
    const chunkEnd = monthEnd < input.to ? monthEnd : input.to
    chunks.push({ from: cursor, to: chunkEnd })
    cursor = nextDay(chunkEnd)
  }
  return ok(chunks)
}

/** The last day of the month a `YYYY-MM-DD` date falls in. */
function endOfMonth(date: string): string {
  const [year, month] = splitDate(date)
  // Day zero of the following month normalizes to the last day of this one -
  // leap years included, with no table. UTC throughout: the result is a
  // wall-clock date, and any local getter puts December 31 into November for
  // half the world.
  const last = new Date(Date.UTC(year, month, 0))
  return isoDate(last)
}

/** The day after a `YYYY-MM-DD` date. */
function nextDay(date: string): string {
  const [year, month, day] = splitDate(date)
  return isoDate(new Date(Date.UTC(year, month - 1, day + 1)))
}

function splitDate(date: string): [number, number, number] {
  const match = DAY_PATTERN.exec(date)
  if (!match) throw new UnprocessableEntityError(`"${date}" is not a YYYY-MM-DD date.`, { date })
  return [Number(match[1]!), Number(match[2]!), Number(match[3]!)]
}

function isoDate(value: Date): string {
  return `${pad4(value.getUTCFullYear())}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function pad4(value: number): string {
  return String(value).padStart(4, '0')
}
