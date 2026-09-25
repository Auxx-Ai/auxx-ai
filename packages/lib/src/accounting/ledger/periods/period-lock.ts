// packages/lib/src/accounting/ledger/periods/period-lock.ts
//
// Where `PeriodLock.lockedThroughMonth` comes from: the reviewed-through marker. The poster
// does not read it; see docs/accounting-architecture-guide.md §7.2.

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { type PeriodLock, parsePeriodKey } from './periods'

/** The catalog key this module owns. `'2026-07'`, or unset for "nothing closed". */
export const PERIOD_LOCK_SETTING_KEY = 'ledger.lockedThroughMonth' as const

/**
 * Resolve one organization's reviewed-through month (`{ lockedThroughMonth: null }` when unset).
 *
 * Fails closed on a value that is not `YYYY-MM`: its readers (the delete guards, the recurring
 * hold, the provider walk) would otherwise read a malformed marker as "nothing reviewed".
 *
 * @throws {UnprocessableEntityError} when the stored value is present but is not a real month.
 */
export async function resolvePeriodLock(
  organizationId: string,
  db?: Database | Transaction
): Promise<PeriodLock> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: PERIOD_LOCK_SETTING_KEY,
    ...(db ? { db } : {}),
  })

  // Unset, cleared, or whitespace. A settings form that clears a text input
  // writes `''` rather than deleting the row, so both spellings of "nothing is
  // closed" have to land in the same place.
  if (raw == null) return { lockedThroughMonth: null }

  if (typeof raw !== 'string') {
    throw new UnprocessableEntityError(
      `The accounting period lock for this organization is not a month: ${describe(raw)}. ` +
        'Set ledger.lockedThroughMonth to a YYYY-MM month, or clear it if nothing is closed.',
      { organizationId, setting: PERIOD_LOCK_SETTING_KEY }
    )
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) return { lockedThroughMonth: null }

  // `parsePeriodKey` owns the keyspace, so the validation is not duplicated
  // here. It accepts a DAY key too, which this setting must not: a lock is by
  // month (`isPeriodLocked` compares months), so `'2026-07-15'` has no meaning -
  // it either locks all of July or none of it, and silently picking one is the
  // fail-open reading in a different costume.
  let granularity: string
  try {
    granularity = parsePeriodKey(trimmed).granularity
  } catch {
    throw new UnprocessableEntityError(
      `The accounting period lock for this organization is not a valid month: "${trimmed}". ` +
        'Set ledger.lockedThroughMonth to a YYYY-MM month, or clear it if nothing is closed.',
      { organizationId, setting: PERIOD_LOCK_SETTING_KEY, value: trimmed }
    )
  }

  if (granularity !== 'month') {
    throw new UnprocessableEntityError(
      `The accounting period lock for this organization is a date, not a month: "${trimmed}". ` +
        'Periods close by month. Set ledger.lockedThroughMonth to YYYY-MM.',
      { organizationId, setting: PERIOD_LOCK_SETTING_KEY, value: trimmed }
    )
  }

  return { lockedThroughMonth: trimmed }
}

/** A non-string setting value, rendered short enough to put in a message. */
function describe(value: unknown): string {
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'
  return `${typeof value} ${JSON.stringify(value)}`
}
