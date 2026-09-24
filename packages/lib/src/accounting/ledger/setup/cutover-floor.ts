// packages/lib/src/accounting/ledger/setup/cutover-floor.ts

import type { Database } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { systemFieldMap } from '../../../resources/system-records'
import { createGuard } from '../../../utils/guard'
import { BANK_DEPOSIT_SOURCE_TYPE } from '../../money/bank-deposits/client'
import { VENDOR_BILL_SOURCE_TYPE } from '../builders/entry'
import { INVOICE_SOURCE_TYPE } from '../builders/invoice'
import { VENDOR_CREDIT_SOURCE_TYPE } from '../builders/vendor-credit'
import { WRITE_OFF_SOURCE_TYPE } from '../builders/write-off'
import type { CutoverFloorFinding, CutoverFloorKind } from './setup-readiness'

const guard = createGuard('ledger:cutover-floor')

/** How one document kind is dated and how its own entry claims it (see plans/accounting/tasks/110 §2 G4). */
interface FloorSpec {
  kind: CutoverFloorKind
  sourceKind: string
  /** The subject occurrence the document's entry claims; a LIKE pattern for a repeatable action. */
  occurrence: { equals: string } | { like: string }
  /** `value` is a calendar-day field; `stamped` is when the field was last written, in the book zone. */
  date: { attribute: string; from: 'value' | 'stamped' }
  status?: { attribute: string; values: readonly string[] }
  /** A zero document posts nothing, so it strands nothing. */
  positive: string
}

const ISSUED_INVOICE = ['sent', 'partially_paid', 'paid', 'written_off'] as const

/** Built per call: the source-kind constants come from modules that import this folder. */
function floorSpecs(): FloorSpec[] {
  return [
    {
      kind: 'vendor_bill',
      sourceKind: VENDOR_BILL_SOURCE_TYPE,
      occurrence: { equals: 'original' },
      date: { attribute: 'vendor_bill_billed_at', from: 'value' },
      status: { attribute: 'vendor_bill_status', values: ['posted'] },
      positive: 'vendor_bill_total',
    },
    {
      kind: 'invoice',
      sourceKind: INVOICE_SOURCE_TYPE,
      occurrence: { equals: 'original' },
      date: { attribute: 'invoice_issued_at', from: 'value' },
      status: { attribute: 'invoice_status', values: ISSUED_INVOICE },
      positive: 'invoice_total',
    },
    {
      // The write-off has no date of its own; its cumulative field is written at the write-off.
      kind: 'invoice_write_off',
      sourceKind: WRITE_OFF_SOURCE_TYPE,
      occurrence: { like: 'write_off:%' },
      date: { attribute: 'invoice_written_off', from: 'stamped' },
      status: { attribute: 'invoice_status', values: ISSUED_INVOICE },
      positive: 'invoice_written_off',
    },
    {
      kind: 'vendor_credit',
      sourceKind: VENDOR_CREDIT_SOURCE_TYPE,
      occurrence: { equals: 'original' },
      date: { attribute: 'vendor_credit_issued_at', from: 'value' },
      status: { attribute: 'vendor_credit_status', values: ['issued', 'settled'] },
      positive: 'vendor_credit_total',
    },
    {
      kind: 'bank_deposit',
      sourceKind: BANK_DEPOSIT_SOURCE_TYPE,
      occurrence: { equals: 'original' },
      date: { attribute: 'bank_deposit_date', from: 'value' },
      positive: 'bank_deposit_total',
    },
  ]
}

/**
 * Per unswept document kind, the live documents dated after `cutoffPeriod` that hold no subject
 * claim. Kinds with none, or whose fields this org lacks, are omitted. Reads only.
 */
export async function readCutoverFloor(
  db: Database,
  input: { organizationId: string; cutoffPeriod: string; bookTimeZone: string }
): Promise<Result<CutoverFloorFinding[], Error>> {
  const { organizationId } = input
  return guard(
    async () => {
      const specs = floorSpecs()
      const attributes = specs.flatMap((spec) => [
        spec.date.attribute,
        spec.positive,
        ...(spec.status ? [spec.status.attribute] : []),
      ])
      const fields = await systemFieldMap(db, organizationId, [...new Set(attributes)])
      const findings = await Promise.all(
        specs.map(async (spec) => {
          const dateField = fields[spec.date.attribute]
          const positiveField = fields[spec.positive]
          const statusField = spec.status ? fields[spec.status.attribute] : null
          if (!dateField || !positiveField || (spec.status && !statusField)) return null
          return countStranded(db, input, spec, {
            date: dateField.id,
            positive: positiveField.id,
            status: statusField?.id ?? null,
          })
        })
      )
      return findings.filter((finding): finding is CutoverFloorFinding => !!finding)
    },
    'Failed to read the documents after the cutover',
    { organizationId }
  )
}

async function countStranded(
  db: Database,
  input: { organizationId: string; cutoffPeriod: string; bookTimeZone: string },
  spec: FloorSpec,
  fieldIds: { date: string; positive: string; status: string | null }
): Promise<CutoverFloorFinding | null> {
  const { organizationId, cutoffPeriod, bookTimeZone } = input
  // Calendar-day fields are stored at UTC midnight and posted as that day, never re-zoned.
  const day =
    spec.date.from === 'value'
      ? sql`(d."valueDate" AT TIME ZONE 'UTC')::date`
      : sql`((d."updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${bookTimeZone})::date`
  const occurrence: SQL =
    'equals' in spec.occurrence
      ? sql`link."occurrence" = ${spec.occurrence.equals}`
      : sql`link."occurrence" LIKE ${spec.occurrence.like}`
  const status =
    spec.status && fieldIds.status
      ? sql`JOIN "FieldValue" s ON s."organizationId" = d."organizationId"
          AND s."entityId" = d."entityId" AND s."fieldId" = ${fieldIds.status}
          AND s."optionId" IN (${sql.join(
            spec.status.values.map((value) => sql`${value}`),
            sql`, `
          )})`
      : sql``

  const result = await db.execute(sql`
    SELECT count(*)::int AS count,
      to_char(min(docs.day), 'YYYY-MM-DD') AS earliest,
      to_char(max(docs.day), 'YYYY-MM-DD') AS latest
    FROM (
      SELECT ${day} AS day
      FROM "FieldValue" d
      JOIN "EntityInstance" e ON e.id = d."entityId" AND e."organizationId" = d."organizationId"
        AND e."archivedAt" IS NULL
      JOIN "FieldValue" t ON t."organizationId" = d."organizationId"
        AND t."entityId" = d."entityId" AND t."fieldId" = ${fieldIds.positive}
        AND t."valueNumber" > 0
      ${status}
      WHERE d."organizationId" = ${organizationId}
        AND d."fieldId" = ${fieldIds.date}
        AND ${spec.date.from === 'value' ? sql`d."valueDate" IS NOT NULL` : sql`TRUE`}
        AND NOT EXISTS (
          SELECT 1 FROM "GlPostingSource" link
          WHERE link."organizationId" = ${organizationId}
            AND link."sourceKind" = ${spec.sourceKind}
            AND link."sourceId" = d."entityId"
            AND link."linkRole" = 'subject'
            AND ${occurrence}
        )
    ) docs
    WHERE to_char(docs.day, 'YYYY-MM') > ${cutoffPeriod}
  `)
  const row = (result.rows as Array<{ count: number; earliest: string; latest: string }>)[0]
  if (!row || Number(row.count) === 0) return null
  return { kind: spec.kind, count: Number(row.count), earliest: row.earliest, latest: row.latest }
}
