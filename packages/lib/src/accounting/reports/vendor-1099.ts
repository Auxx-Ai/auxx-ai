// packages/lib/src/accounting/reports/vendor-1099.ts
//
// The 1099 summary READ: eligible vendors whose `vendor_payment` movements for a
// calendar year meet the IRS $600 filing threshold, grouped by 1099 box
// (plans/accounting/HANDOFF.md slot 2K; ui-plan.md §3 "1099 / W-9").
//
// UNLIKE every other report in this folder, this one is NOT a GL read: it sums
// `MoneyTransaction` rows with purpose `vendor_payment` by `partyInstanceId`
// (task 71 U5), then hydrates the vendor's own 1099 fields off `company`.
//
// The types and the pure `toXRows`/CSV shaping live in `vendor-1099-rows.ts`,
// split out for the same reason `adapters.ts` is split from `trial-balance.ts`
// et al: this file imports `@auxx/database` at runtime, so it cannot be
// `client.ts`-safe. Re-exported below so a server caller has one import site.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { startOfDayInstant } from '@auxx/utils/calendar-day'
import { and, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { AuxxError, BadRequestError } from '../../errors'
import { getOrganizationSetting } from '../../settings/settings-service'
import { OPENING_BASELINE_SETTING_KEYS } from '../ledger/setup/setup-readiness'
import {
  VENDOR_1099_THRESHOLD_MINOR,
  type Vendor1099Row,
  type Vendor1099Summary,
} from './vendor-1099-rows'

export {
  toVendor1099CsvRows,
  toVendor1099Rows,
  VENDOR_1099_COLUMNS,
  VENDOR_1099_THRESHOLD_MINOR,
  type Vendor1099Row,
  type Vendor1099Summary,
} from './vendor-1099-rows'

const logger = createScopedLogger('postings:reports:vendor-1099')

const COMPANY_1099_ATTRIBUTES = [
  'company_is_1099_eligible',
  'company_default_1099_box',
  'company_tax_classification',
  'company_tin',
  'company_w9_on_file',
] as const

export interface ReadVendor1099SummaryOptions {
  organizationId: string
  year: number
}

/** A setting value as a non-empty string, else null - `close-periods.ts` reads the same way. */
function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function emptySummary(organizationId: string, year: number): Vendor1099Summary {
  return {
    organizationId,
    year,
    thresholdMinor: VENDOR_1099_THRESHOLD_MINOR,
    companyDefId: null,
    rows: [],
    totalMinor: 0,
  }
}

/**
 * Aggregate `vendor_payment` movements by vendor over a calendar year, keep only
 * companies marked `is1099Eligible` whose total reaches
 * {@link VENDOR_1099_THRESHOLD_MINOR}, and box each one.
 *
 * Returns an EMPTY summary (never an error) when the org has no 1099 fields on
 * `company` - the identical "absent rather than failed" rule `124`/`129`'s
 * migrations follow.
 */
export async function readVendor1099Summary(
  db: Database,
  options: ReadVendor1099SummaryOptions
): Promise<Result<Vendor1099Summary, Error>> {
  const { organizationId, year } = options

  try {
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      return err(
        new BadRequestError(`Expected a four-digit year, got ${String(year)}`, {
          year: String(year),
        })
      )
    }

    const companyFields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([...COMPANY_1099_ATTRIBUTES])

    // 🛑 Half-open year bounds drawn at the BOOK zone's own midnight, not at
    // UTC's. A movement observed at 4pm on Dec 31 in `America/Los_Angeles` is
    // already Jan 1 in UTC: UTC bounds would file it on the wrong year's 1099.
    const bookTimeZone =
      readText(
        await getOrganizationSetting({
          organizationId,
          key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
        })
      ) ?? 'UTC'
    const yearStart = startOfDayInstant(`${year}-01-01`, bookTimeZone)
    const yearEnd = startOfDayInstant(`${year + 1}-01-01`, bookTimeZone)

    // ⚠️ A movement carries its date in ONE of two columns, so the year window
    // is an OR over both rather than a range over one.
    const grouped = await db
      .select({
        companyId: schema.MoneyTransaction.partyInstanceId,
        totalMinor: sql<string>`coalesce(sum(${schema.MoneyTransaction.amountMinor}), 0)`,
      })
      .from(schema.MoneyTransaction)
      .where(
        and(
          eq(schema.MoneyTransaction.organizationId, organizationId),
          eq(schema.MoneyTransaction.purpose, 'vendor_payment'),
          isNotNull(schema.MoneyTransaction.partyInstanceId),
          or(
            and(
              gte(schema.MoneyTransaction.occurredAt, yearStart),
              lt(schema.MoneyTransaction.occurredAt, yearEnd)
            ),
            and(
              gte(schema.MoneyTransaction.occurredOn, yearStart.toISOString().slice(0, 10)),
              lt(schema.MoneyTransaction.occurredOn, yearEnd.toISOString().slice(0, 10))
            )
          )
        )
      )
      .groupBy(schema.MoneyTransaction.partyInstanceId)

    const totalsByCompany = new Map<string, number>()
    for (const row of grouped) {
      if (!row.companyId) continue
      const totalMinor = Number(row.totalMinor)
      if (totalMinor < VENDOR_1099_THRESHOLD_MINOR) continue
      totalsByCompany.set(row.companyId, totalMinor)
    }

    if (totalsByCompany.size === 0) return ok(emptySummary(organizationId, year))

    const companyIds = [...totalsByCompany.keys()]
    const companyInfo = await loadCompany1099Info(db, organizationId, companyIds, companyFields)

    const rows: Vendor1099Row[] = []
    for (const companyId of companyIds) {
      const info = companyInfo.get(companyId)
      // A company that vanished, or is not marked eligible, is silently
      // omitted - eligibility is an affirmative marker (defaultValue false),
      // not an absence.
      if (!info?.is1099Eligible) continue
      rows.push({
        companyId,
        companyName: info.name,
        box: info.default1099Box ?? 'none',
        totalMinor: totalsByCompany.get(companyId) ?? 0,
        taxClassification: info.taxClassification,
        tin: info.tin,
        w9OnFile: info.w9OnFile,
      })
    }

    rows.sort((a, b) => a.companyName.localeCompare(b.companyName))

    return ok({
      organizationId,
      year,
      thresholdMinor: VENDOR_1099_THRESHOLD_MINOR,
      // What turns a vendor row into a drill-down - see the field's own JSDoc.
      companyDefId: (await getCachedEntityDefId(organizationId, 'company')) ?? null,
      rows,
      totalMinor: rows.reduce((sum, row) => sum + row.totalMinor, 0),
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the 1099 summary', { error, organizationId, year })
    return err(new AuxxError('Internal error'))
  }
}

interface CompanyFieldIds {
  company_is_1099_eligible?: { id: string } | null
  company_default_1099_box?: { id: string } | null
  company_tax_classification?: { id: string } | null
  company_tin?: { id: string } | null
  company_w9_on_file?: { id: string } | null
}

interface Company1099Info {
  name: string
  is1099Eligible: boolean
  default1099Box: string | null
  taxClassification: string | null
  tin: string | null
  w9OnFile: boolean
}

/**
 * The 1099 fields (plus `displayName`) for a page of companies, in ONE
 * additional query - the same "page of ids, then one hydrate query" shape
 * `journal-entries/reads.ts`'s `hydrate` uses, rather than a join per attribute
 * on the aggregate query above.
 */
async function loadCompany1099Info(
  db: Database,
  organizationId: string,
  companyIds: string[],
  fields: CompanyFieldIds
): Promise<Map<string, Company1099Info>> {
  const [instances, values] = await Promise.all([
    db
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, companyIds)
        )
      ),
    (async () => {
      const fieldIds = Object.values(fields)
        .filter((f): f is { id: string } => f != null)
        .map((f) => f.id)
      if (fieldIds.length === 0) return []
      return db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
          valueBoolean: schema.FieldValue.valueBoolean,
          optionId: schema.FieldValue.optionId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, companyIds),
            inArray(schema.FieldValue.fieldId, fieldIds)
          )
        )
    })(),
  ])

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const result = new Map<string, Company1099Info>()
  for (const instance of instances) {
    const bucket = byInstance.get(instance.id)
    const read = (field?: { id: string } | null) => (field ? bucket?.get(field.id) : undefined)

    result.set(instance.id, {
      name: instance.displayName ?? '',
      is1099Eligible: read(fields.company_is_1099_eligible)?.valueBoolean ?? false,
      default1099Box: read(fields.company_default_1099_box)?.optionId ?? null,
      taxClassification: read(fields.company_tax_classification)?.optionId ?? null,
      tin: read(fields.company_tin)?.valueText ?? null,
      w9OnFile: read(fields.company_w9_on_file)?.valueBoolean ?? false,
    })
  }
  return result
}
