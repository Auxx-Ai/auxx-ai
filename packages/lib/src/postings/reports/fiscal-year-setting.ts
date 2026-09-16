// packages/lib/src/postings/reports/fiscal-year-setting.ts
//
// The server half of the fiscal-year boundary: one settings read.
//
// Split from `fiscal-year.ts` because that file must stay client-safe -
// `settings/catalog.ts` imports its option list, `postings/client.ts` exports
// `fiscalYearStart`, and `settings-service.ts` reaches `@auxx/database`.

import type { Database, Transaction } from '@auxx/database'
import { getOrganizationSetting } from '../../settings/settings-service'
import { FISCAL_YEAR_START_MONTH_SETTING_KEY, normalizeFiscalYearStartMonth } from './fiscal-year'

/**
 * The org's fiscal-year start month, 1-12. January when unset or unparseable.
 *
 * Answers from the org cache when no `db` is passed, like every other settings
 * read in this folder. Every read path that draws the fiscal-year boundary -
 * the balance sheet, the trial balance, the general ledger - must call this and
 * pass the result to `fiscalYearStart`, or the reports disagree with each other
 * (`docs/accounting-architecture-guide.md` §12.1).
 */
export async function resolveFiscalYearStartMonth(
  organizationId: string,
  db?: Database | Transaction
): Promise<number> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: FISCAL_YEAR_START_MONTH_SETTING_KEY,
    ...(db ? { db } : {}),
  })
  return normalizeFiscalYearStartMonth(raw)
}
