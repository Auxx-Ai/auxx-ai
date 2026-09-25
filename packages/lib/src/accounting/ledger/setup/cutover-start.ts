// packages/lib/src/accounting/ledger/setup/cutover-start.ts

import { fromZonedTime } from 'date-fns-tz'
import { readOrganizationSettings } from '../../../settings/read'
import { cutoverDateFor } from '../builders/opening-balance'
import { isAccountingActive } from './accounting-enabled'

/** Midnight, in the book time zone, after the cutoff month; null with no cutoff month set. */
export async function readCutoverStart(organizationId: string): Promise<Date | null> {
  const settings = await readOrganizationSettings(organizationId, [
    'accounting.cutoffPeriod',
    'accounting.bookTimeZone',
  ] as const)
  const cutoff = settings['accounting.cutoffPeriod']?.trim()
  if (!cutoff) return null
  // cutoverDateFor refuses a day-granular cutoff; its month is 1-based, so Date.UTC rolls to the next.
  const [year, month] = cutoverDateFor(cutoff).split('-').map(Number) as [number, number]
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  const zone = settings['accounting.bookTimeZone']?.trim() || 'UTC'
  return fromZonedTime(`${nextMonth}T00:00:00`, zone)
}

/** The cutover start for an accounting-active org; null otherwise or with no cutoff set. */
export async function readActiveCutoverStart(organizationId: string): Promise<Date | null> {
  if (!(await isAccountingActive(organizationId))) return null
  return readCutoverStart(organizationId)
}
