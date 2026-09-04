// packages/lib/src/postings/reports/vendor-1099.ts
//
// The 1099 summary READ: eligible vendors whose POSTED `vendor_payment` total
// for a calendar year meets the IRS $600 filing threshold, grouped by 1099 box
// (plans/accounting/HANDOFF.md slot 2K; ui-plan.md §3 "1099 / W-9").
//
// UNLIKE every other report in this folder, this one is NOT a GL read - it
// predates the ledger side of a vendor payment entirely (`vendor_payment` ships
// inert per its own field-file header: no writer, no UI, isVisible: false).
// So the source of truth here is the `vendor_payment` and `company`
// EntityInstances themselves, read the way `postings/journal-entries/reads.ts`
// reads a draft: one `FieldValue` alias per attribute, joined on `entityId`.
//
// The types and the pure `toXRows`/CSV shaping live in `vendor-1099-rows.ts`,
// split out for the same reason `adapters.ts` is split from `trial-balance.ts`
// et al: this file imports `@auxx/database` at runtime, so it cannot be
// `client.ts`-safe. Re-exported below so a server caller has one import site.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { AuxxError, BadRequestError } from '../../errors'
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

/** Only a POSTED vendor payment counts - a draft or void row moved no money. */
const COUNTED_STATUS = 'posted'

const VENDOR_PAYMENT_ATTRIBUTES = [
  'vendor_payment_vendor',
  'vendor_payment_amount',
  'vendor_payment_paid_at',
  'vendor_payment_status',
] as const

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

function emptySummary(organizationId: string, year: number): Vendor1099Summary {
  return {
    organizationId,
    year,
    thresholdMinor: VENDOR_1099_THRESHOLD_MINOR,
    rows: [],
    totalMinor: 0,
  }
}

/**
 * Aggregate posted `vendor_payment` amounts by vendor (company) over a
 * calendar year, keep only companies marked `is1099Eligible` whose total
 * reaches {@link VENDOR_1099_THRESHOLD_MINOR}, and box each one.
 *
 * Returns an EMPTY summary (never an error) when the org predates the
 * `vendor_payment` entity or its 1099 fields on `company` - the identical
 * "absent rather than failed" rule `124`/`129`'s migrations follow, because an
 * org that has not run the migrations has nothing to report, not a broken read.
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

    const vendorPaymentDefId = await getCachedEntityDefId(organizationId, 'vendor_payment')
    if (!vendorPaymentDefId) return ok(emptySummary(organizationId, year))

    const vpFields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([...VENDOR_PAYMENT_ATTRIBUTES])
    if (
      !vpFields.vendor_payment_vendor ||
      !vpFields.vendor_payment_amount ||
      !vpFields.vendor_payment_paid_at ||
      !vpFields.vendor_payment_status
    ) {
      return ok(emptySummary(organizationId, year))
    }

    const companyFields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([...COMPANY_1099_ATTRIBUTES])

    // Half-open UTC year bounds, the same shape `journal-entries/reads.ts`'s
    // `monthBoundsUtc` uses for a DATETIME `FieldValue.valueDate` - `paidAt` is
    // an instant, not a calendar date, so a string-prefix compare would depend
    // on driver rendering.
    const yearStart = new Date(Date.UTC(year, 0, 1)).toISOString()
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1)).toISOString()

    const amountValue = alias(schema.FieldValue, 'vp_amount')
    const vendorValue = alias(schema.FieldValue, 'vp_vendor')
    const paidAtValue = alias(schema.FieldValue, 'vp_paid_at')
    const statusValue = alias(schema.FieldValue, 'vp_status')

    const grouped = await db
      .select({
        companyId: vendorValue.relatedEntityId,
        totalMinor: sql<string>`coalesce(sum(${amountValue.valueNumber}), 0)`,
      })
      .from(amountValue)
      .innerJoin(
        vendorValue,
        and(
          eq(vendorValue.entityId, amountValue.entityId),
          eq(vendorValue.organizationId, organizationId),
          eq(vendorValue.fieldId, vpFields.vendor_payment_vendor.id),
          isNotNull(vendorValue.relatedEntityId)
        )
      )
      .innerJoin(
        paidAtValue,
        and(
          eq(paidAtValue.entityId, amountValue.entityId),
          eq(paidAtValue.organizationId, organizationId),
          eq(paidAtValue.fieldId, vpFields.vendor_payment_paid_at.id),
          gte(paidAtValue.valueDate, yearStart),
          lt(paidAtValue.valueDate, yearEnd)
        )
      )
      .innerJoin(
        statusValue,
        and(
          eq(statusValue.entityId, amountValue.entityId),
          eq(statusValue.organizationId, organizationId),
          eq(statusValue.fieldId, vpFields.vendor_payment_status.id),
          eq(statusValue.optionId, COUNTED_STATUS)
        )
      )
      .where(
        and(
          eq(amountValue.organizationId, organizationId),
          eq(amountValue.fieldId, vpFields.vendor_payment_amount.id)
        )
      )
      .groupBy(vendorValue.relatedEntityId)

    const totalsByCompany = new Map<string, number>()
    for (const row of grouped) {
      if (!row.companyId) continue
      const totalMinor = toMinor(row.totalMinor)
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

function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
