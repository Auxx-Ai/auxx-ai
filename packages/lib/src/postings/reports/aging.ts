// packages/lib/src/postings/reports/aging.ts
//
// A/R and A/P aging (plans/accounting/HANDOFF.md slot 2H; tasks/05-aging.md).
// Built from the GL, not the subledger: task 05 §1 is explicit that a
// subledger aging that does not tie to the balance sheet's own A/R or A/P is
// the single most common "my accounting software is lying to me" complaint,
// and it is unfixable after the fact because the two numbers have different
// definitions. So this reads posted `accounts_receivable`/`accounts_payable`
// lines, groups them by the DOCUMENT their `sourceType`/`sourceId` names
// (netting debits and credits per document as of `asOf`), and asserts its own
// total against `readTrialBalance`'s figure for the same role and date - the
// `verdict`, shown even when it is false.
//
// BUCKETING. Always on the document's DUE DATE, never on issue date (task 05
// §3): a net-60 invoice issued 45 days ago is `current`, not `31-60`. A
// document with no due date - an unapplied payment, a manual adjustment, the
// opening entry - has nothing to bucket on and is always `current`.
//
// DOCUMENT SOURCES. `sourceType` on a posted line names what produced it:
// `invoice` (a write-off, `build-write-off-entry.ts`), `vendor_bill` (the
// matched bill entry, `build-entry.ts`), `order` (a fulfillment entry -
// `build-fulfillment-entry.ts` posts A/R by ORDER, not by invoice; orders
// carry no due date and settle under the order's own contact/company),
// `payment_transaction` (a payment or refund, `build-payment-entry.ts` -
// resolved against the ledger row's own `contactInstanceId`, never the
// `payment` entity mirror, which refund rows never get) and `journal_entry`
// (a manual or opening entry, which carries no contact). Every one of these
// is handled; nothing is dropped. A `sourceType` this file does not know
// about falls into the same "Unapplied and adjustments" catch-all a
// `journal_entry` line does, so the total still ties even for a source this
// read has never heard of.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, lte } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { readFieldRelations, readFieldScalars } from '../../field-values/read-field-scalars'
import { ACCOUNT_ROLES } from '../build-entry'
import { loadRoleAccountCodes } from '../resolve-roles'
import { type StatementColumn, type StatementRow, totalRow } from './rows'
import { signedBalance } from './statement-math'
import { readTrialBalance } from './trial-balance'

const logger = createScopedLogger('postings:reports:aging')

/** Only a posted entry counts - the same rule every reader in this folder follows. */
const POSTED_STATUSES = ['posted', 'reversed'] as const

/** Which receivable/payable role this read walks. */
export type AgingSide = 'receivable' | 'payable'

/** The five buckets task 05 §2 names, in age order. */
export type AgingBucketKey = 'current' | '1_30' | '31_60' | '61_90' | '90_plus'

const BUCKET_KEYS: readonly AgingBucketKey[] = ['current', '1_30', '31_60', '61_90', '90_plus']

const BUCKET_LABELS: Record<AgingBucketKey, string> = {
  current: 'Current',
  '1_30': '1-30',
  '31_60': '31-60',
  '61_90': '61-90',
  '90_plus': '90+',
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

function assertDayFormat(date: string, label: string): void {
  if (!DAY_PATTERN.test(date)) {
    throw new UnprocessableEntityError(`${label} must be YYYY-MM-DD, got "${date}"`, { date })
  }
}

/** Calendar days from `dueDate` to `asOf` - positive when `asOf` is later. Both `YYYY-MM-DD`. */
function daysPastDue(asOf: string, dueDate: string): number {
  assertDayFormat(asOf, 'asOf')
  assertDayFormat(dueDate, 'dueDate')
  const a = DAY_PATTERN.exec(asOf)!
  const d = DAY_PATTERN.exec(dueDate)!
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const asOfUtc = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))
  const dueUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))
  return Math.round((asOfUtc - dueUtc) / MS_PER_DAY)
}

/**
 * Which bucket a document falls in, per task 05 §3: bucketed on the DUE DATE,
 * never on the issue date. `dueDate: null` (no terms to age against - an
 * unapplied payment, a manual adjustment, the opening entry, an `order`,
 * which carries no due date at all) is always `current`, per task 05 §1's
 * decision. Not yet due, or due today, is `current` too - only a STRICTLY
 * past due date starts a bucket.
 *
 * Pure and exported so the bucket boundaries are testable with no database.
 */
export function agingBucket(asOf: string, dueDate: string | null): AgingBucketKey {
  if (!dueDate) return 'current'
  const days = daysPastDue(asOf, dueDate)
  if (days <= 0) return 'current'
  if (days <= 30) return '1_30'
  if (days <= 60) return '31_60'
  if (days <= 90) return '61_90'
  return '90_plus'
}

/** `YYYY-MM-DD`, or `null` when the stored value is not a date string. `FieldValue.valueDate` arrives as an ISO instant. */
function toDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null
  return value.slice(0, 10)
}

function zeroBucketTotals(): Record<AgingBucketKey, number> {
  return { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 }
}

/** One document (invoice, vendor bill, order, payment, or a manual/opening line) behind a group. */
export interface AgingDocument {
  sourceType: string
  sourceId: string
  /** The document's own number when one resolves; else the GL posting's own `docNumber`. */
  label: string
  /** `YYYY-MM-DD`, when the document carries one. */
  issuedAt: string | null
  /** `YYYY-MM-DD`. `null` means no due date - always buckets to `current`. */
  dueDate: string | null
  /** Natural-sign net for this document as of `asOf`. Negative is a credit balance - never hidden. */
  openMinor: number
  bucket: AgingBucketKey
  /** `awaiting_receipt` | `exception` on a payable document; absent otherwise. */
  badge?: string
  /** `defId:instanceId`, when the document is a real record (`invoice` or `vendor_bill`) the drawer can open. */
  recordId?: string
}

/** One contact (A/R) or company (A/P) group, or the `'unapplied'` catch-all. */
export interface AgingGroup {
  /** The contact/company instance id, or `'unapplied'`. */
  groupId: string
  groupName: string
  documents: AgingDocument[]
  bucketTotals: Record<AgingBucketKey, number>
  totalMinor: number
}

export interface Aging {
  organizationId: string
  side: AgingSide
  asOf: string
  /** The org's own account code carrying the role, or `null` when the role is unmapped. */
  accountCode: string | null
  groups: AgingGroup[]
  bucketTotals: Record<AgingBucketKey, number>
  totalMinor: number
  /** `readTrialBalance`'s own figure for the same role's account, as of the same date. */
  balanceSheetMinor: number
  /** `totalMinor === balanceSheetMinor`. `false` is shown, never hidden - task 05 §2. */
  verdict: boolean
  differenceMinor: number
}

export interface ReadAgingOptions {
  organizationId: string
  side: AgingSide
  /** `YYYY-MM-DD`. */
  asOf: string
}

/** The catch-all every document with no resolvable contact/company falls into. Never dropped. */
export const AGING_UNAPPLIED_GROUP_ID = 'unapplied'
const UNAPPLIED_GROUP_NAME = 'Unapplied and adjustments'

const DOCUMENT_SCALAR_ATTRIBUTES = [
  'invoice_due_date',
  'invoice_issued_at',
  'invoice_number',
  'vendor_bill_due_at',
  'vendor_bill_number',
  'vendor_bill_status',
  'order_number',
] as const

const DOCUMENT_RELATION_ATTRIBUTES = [
  'invoice_contact',
  'vendor_bill_vendor',
  'order_contact',
  'order_company',
] as const

/** The two statuses task 05 §0 (via the review) says an open payable may carry and never be dropped for. */
const AP_BADGE_STATUSES = new Set(['awaiting_receipt', 'exception'])

function emptyAging(options: ReadAgingOptions, accountCode: string | null): Aging {
  return {
    organizationId: options.organizationId,
    side: options.side,
    asOf: options.asOf,
    accountCode,
    groups: [],
    bucketTotals: zeroBucketTotals(),
    totalMinor: 0,
    balanceSheetMinor: 0,
    verdict: true,
    differenceMinor: 0,
  }
}

interface DocAccum {
  sourceType: string
  sourceId: string
  debitMinor: number
  creditMinor: number
  docNumber: string
}

interface ResolvedDocument {
  accum: DocAccum
  openMinor: number
  groupId: string
  label: string
  issuedAt: string | null
  dueDate: string | null
  badge?: string
  recordId?: string
}

/**
 * A/R or A/P aging as of `asOf`, from the GL.
 *
 * Resolves the side's role (`accounts_receivable` | `accounts_payable`) to
 * this org's own account via {@link loadRoleAccountCodes} - a READER's door,
 * not a poster's, so an unmapped role is reported as an empty, trivially
 * verdict-true aging (nothing could have posted to it) rather than refused.
 *
 * Every posted line against that account, through `asOf`, is grouped by the
 * document its `sourceType`/`sourceId` names and netted by the account's own
 * natural direction ({@link signedBalance}) - a fully paid document nets to
 * zero and is dropped from the listing (an "open" aging, per task 05's
 * title), while a genuinely open credit balance stays negative, in `current`,
 * per task 05 §3.
 */
export async function readAging(
  db: Database,
  options: ReadAgingOptions
): Promise<Result<Aging, Error>> {
  const { organizationId, side, asOf } = options
  const role =
    side === 'receivable' ? ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE : ACCOUNT_ROLES.ACCOUNTS_PAYABLE

  try {
    const accounts = await loadRoleAccountCodes(db, organizationId, [role])
    const account = accounts.get(role)
    // Unmapped: nothing could have posted to a role nobody has assigned an
    // account to. An empty, trivially-tied aging, not a refusal - the same
    // "absent rather than failed" rule `vendor-1099.ts`'s `emptySummary` follows.
    if (!account) return ok(emptyAging(options, null))

    const rawLines = await db
      .select({
        sourceType: schema.GlPostingLine.sourceType,
        sourceId: schema.GlPostingLine.sourceId,
        direction: schema.GlPostingLine.direction,
        amountMinor: schema.GlPostingLine.amountMinor,
        docNumber: schema.GlPosting.docNumber,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
          eq(schema.GlPostingLine.accountCode, account.code),
          lte(schema.GlPosting.txnDate, asOf)
        )
      )

    // ── Net per document, keyed on sourceType/sourceId ───────────────────
    // A reversal shares its original's sourceId (it re-accounts for the same
    // document), so this single grouping nets an original against its own
    // reversal to zero without special-casing revisions.
    const byDoc = new Map<string, DocAccum>()
    for (const line of rawLines) {
      const key = `${line.sourceType}:${line.sourceId}`
      let accum = byDoc.get(key)
      if (!accum) {
        accum = {
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          debitMinor: 0,
          creditMinor: 0,
          docNumber: line.docNumber,
        }
        byDoc.set(key, accum)
      }
      if (line.direction === 'debit') accum.debitMinor += line.amountMinor
      else accum.creditMinor += line.amountMinor
    }

    const openDocs = [...byDoc.values()]
      .map((accum) => ({
        accum,
        openMinor: signedBalance(accum.debitMinor, accum.creditMinor, account.accountType),
      }))
      // A document that nets to zero is fully settled - it does not belong in
      // an OPEN aging (task 05's title), though its zero already contributed
      // nothing to the total either way.
      .filter((doc) => doc.openMinor !== 0)

    // ── Batch-resolve the documents behind every non-zero line ───────────
    const fieldDocumentIds = openDocs
      .filter((d) => ['invoice', 'vendor_bill', 'order'].includes(d.accum.sourceType))
      .map((d) => d.accum.sourceId)
    const paymentTransactionIds = openDocs
      .filter((d) => d.accum.sourceType === 'payment_transaction')
      .map((d) => d.accum.sourceId)

    const cf = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([...DOCUMENT_SCALAR_ATTRIBUTES, ...DOCUMENT_RELATION_ATTRIBUTES])

    const scalarFieldIds = [
      cf.invoice_due_date?.id,
      cf.invoice_issued_at?.id,
      cf.invoice_number?.id,
      cf.vendor_bill_due_at?.id,
      cf.vendor_bill_number?.id,
      cf.vendor_bill_status?.id,
      cf.order_number?.id,
    ].filter((id): id is string => !!id)
    const relationFieldIds = [
      cf.invoice_contact?.id,
      cf.vendor_bill_vendor?.id,
      cf.order_contact?.id,
      cf.order_company?.id,
    ].filter((id): id is string => !!id)

    const [scalars, relations, paymentTransactions, invoiceDefId, vendorBillDefId] =
      await Promise.all([
        readFieldScalars(db, organizationId, fieldDocumentIds, scalarFieldIds),
        readFieldRelations(db, organizationId, fieldDocumentIds, relationFieldIds),
        paymentTransactionIds.length > 0
          ? db
              .select({
                id: schema.PaymentTransaction.id,
                contactInstanceId: schema.PaymentTransaction.contactInstanceId,
                reference: schema.PaymentTransaction.reference,
                kind: schema.PaymentTransaction.kind,
              })
              .from(schema.PaymentTransaction)
              .where(
                and(
                  eq(schema.PaymentTransaction.organizationId, organizationId),
                  inArray(schema.PaymentTransaction.id, paymentTransactionIds)
                )
              )
          : Promise.resolve([]),
        side === 'receivable' ? getCachedEntityDefId(organizationId, 'invoice') : undefined,
        side === 'payable' ? getCachedEntityDefId(organizationId, 'vendor_bill') : undefined,
      ])
    const paymentById = new Map(paymentTransactions.map((p) => [p.id, p]))

    const resolved: ResolvedDocument[] = openDocs.map((doc) => {
      const { sourceType, sourceId, docNumber } = doc.accum

      if (sourceType === 'invoice') {
        const numberRaw = cf.invoice_number
          ? scalars.get(sourceId)?.get(cf.invoice_number.id)
          : undefined
        const contactId = cf.invoice_contact
          ? relations.get(sourceId)?.get(cf.invoice_contact.id)
          : undefined
        return {
          accum: doc.accum,
          openMinor: doc.openMinor,
          groupId: contactId ?? AGING_UNAPPLIED_GROUP_ID,
          label: typeof numberRaw === 'string' && numberRaw ? numberRaw : docNumber,
          issuedAt: toDateOnly(
            cf.invoice_issued_at ? scalars.get(sourceId)?.get(cf.invoice_issued_at.id) : undefined
          ),
          dueDate: toDateOnly(
            cf.invoice_due_date ? scalars.get(sourceId)?.get(cf.invoice_due_date.id) : undefined
          ),
          recordId: invoiceDefId ? `${invoiceDefId}:${sourceId}` : undefined,
        }
      }

      if (sourceType === 'vendor_bill') {
        const numberRaw = cf.vendor_bill_number
          ? scalars.get(sourceId)?.get(cf.vendor_bill_number.id)
          : undefined
        const statusRaw = cf.vendor_bill_status
          ? scalars.get(sourceId)?.get(cf.vendor_bill_status.id)
          : undefined
        const vendorId = cf.vendor_bill_vendor
          ? relations.get(sourceId)?.get(cf.vendor_bill_vendor.id)
          : undefined
        return {
          accum: doc.accum,
          openMinor: doc.openMinor,
          groupId: vendorId ?? AGING_UNAPPLIED_GROUP_ID,
          label: typeof numberRaw === 'string' && numberRaw ? numberRaw : docNumber,
          issuedAt: null,
          dueDate: toDateOnly(
            cf.vendor_bill_due_at ? scalars.get(sourceId)?.get(cf.vendor_bill_due_at.id) : undefined
          ),
          badge:
            typeof statusRaw === 'string' && AP_BADGE_STATUSES.has(statusRaw)
              ? statusRaw
              : undefined,
          recordId: vendorBillDefId ? `${vendorBillDefId}:${sourceId}` : undefined,
        }
      }

      if (sourceType === 'order') {
        const numberRaw = cf.order_number
          ? scalars.get(sourceId)?.get(cf.order_number.id)
          : undefined
        const contactId = cf.order_contact
          ? relations.get(sourceId)?.get(cf.order_contact.id)
          : undefined
        const companyId = cf.order_company
          ? relations.get(sourceId)?.get(cf.order_company.id)
          : undefined
        return {
          accum: doc.accum,
          openMinor: doc.openMinor,
          groupId: contactId ?? companyId ?? AGING_UNAPPLIED_GROUP_ID,
          label: typeof numberRaw === 'string' && numberRaw ? numberRaw : docNumber,
          issuedAt: null,
          // Orders carry no due date - DTC/dealer settlement is immediate, not
          // net terms. Always `current`, per `agingBucket`.
          dueDate: null,
        }
      }

      if (sourceType === 'payment_transaction') {
        const payment = paymentById.get(sourceId)
        return {
          accum: doc.accum,
          openMinor: doc.openMinor,
          groupId: payment?.contactInstanceId ?? AGING_UNAPPLIED_GROUP_ID,
          label: payment?.reference || (payment?.kind === 'refund' ? 'Refund' : 'Payment'),
          issuedAt: null,
          dueDate: null,
        }
      }

      // `journal_entry` (a manual or opening line), or any other sourceType
      // this read does not know about - never dropped, always the catch-all.
      return {
        accum: doc.accum,
        openMinor: doc.openMinor,
        groupId: AGING_UNAPPLIED_GROUP_ID,
        label: docNumber,
        issuedAt: null,
        dueDate: null,
      }
    })

    // ── Names for every resolved contact/company ─────────────────────────
    const groupIds = [
      ...new Set(resolved.map((r) => r.groupId).filter((id) => id !== AGING_UNAPPLIED_GROUP_ID)),
    ]
    const names =
      groupIds.length > 0
        ? await db
            .select({
              id: schema.EntityInstance.id,
              displayName: schema.EntityInstance.displayName,
            })
            .from(schema.EntityInstance)
            .where(
              and(
                eq(schema.EntityInstance.organizationId, organizationId),
                inArray(schema.EntityInstance.id, groupIds)
              )
            )
        : []
    const nameById = new Map(names.map((n) => [n.id, n.displayName ?? '']))

    // ── Assemble groups ────────────────────────────────────────────────────
    const groupsById = new Map<string, AgingGroup>()
    for (const r of resolved) {
      const bucket = agingBucket(asOf, r.dueDate)
      const document: AgingDocument = {
        sourceType: r.accum.sourceType,
        sourceId: r.accum.sourceId,
        label: r.label,
        issuedAt: r.issuedAt,
        dueDate: r.dueDate,
        openMinor: r.openMinor,
        bucket,
        badge: r.badge,
        recordId: r.recordId,
      }
      let group = groupsById.get(r.groupId)
      if (!group) {
        group = {
          groupId: r.groupId,
          groupName:
            r.groupId === AGING_UNAPPLIED_GROUP_ID
              ? UNAPPLIED_GROUP_NAME
              : nameById.get(r.groupId) || r.groupId,
          documents: [],
          bucketTotals: zeroBucketTotals(),
          totalMinor: 0,
        }
        groupsById.set(r.groupId, group)
      }
      group.documents.push(document)
      group.bucketTotals[bucket] += document.openMinor
      group.totalMinor += document.openMinor
    }

    const groups = [...groupsById.values()].sort((a, b) => {
      if (a.groupId === AGING_UNAPPLIED_GROUP_ID) return 1
      if (b.groupId === AGING_UNAPPLIED_GROUP_ID) return -1
      return a.groupName.localeCompare(b.groupName)
    })
    for (const group of groups) {
      group.documents.sort(
        (a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.label.localeCompare(b.label)
      )
    }

    const bucketTotals = zeroBucketTotals()
    let totalMinor = 0
    for (const group of groups) {
      for (const key of BUCKET_KEYS) bucketTotals[key] += group.bucketTotals[key]
      totalMinor += group.totalMinor
    }

    // ── The tie assertion ──────────────────────────────────────────────────
    const tbResult = await readTrialBalance(db, { organizationId, to: asOf })
    if (tbResult.isErr()) return err(tbResult.error)
    const balanceSheetMinor =
      tbResult.value.rows.find((row) => row.accountCode === account.code)?.balanceMinor ?? 0
    const differenceMinor = totalMinor - balanceSheetMinor

    return ok({
      organizationId,
      side,
      asOf,
      accountCode: account.code,
      groups,
      bucketTotals,
      totalMinor,
      balanceSheetMinor,
      verdict: differenceMinor === 0,
      differenceMinor,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read aging', { error, organizationId, side, asOf })
    return err(new AuxxError('Internal error'))
  }
}

/** Aging's own columns: one per bucket, plus the row's own total - task 05 §2, `ui-plan.md` §2.5. */
export const AGING_COLUMNS: StatementColumn[] = [
  { key: 'current', label: 'Current', align: 'right' },
  { key: '1_30', label: '1-30', align: 'right' },
  { key: '31_60', label: '31-60', align: 'right' },
  { key: '61_90', label: '61-90', align: 'right' },
  { key: '90_plus', label: '90+', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
]

function bucketValues(totals: Record<AgingBucketKey, number>, total: number): Array<number | null> {
  return [...BUCKET_KEYS.map((key) => totals[key]), total]
}

/** One document's row: its open amount in its OWN bucket column only, everything else empty. */
function documentValues(doc: AgingDocument): Array<number | null> {
  const values: Array<number | null> = BUCKET_KEYS.map((key) =>
    key === doc.bucket ? doc.openMinor : null
  )
  values.push(doc.openMinor)
  return values
}

/**
 * `Aging` as `StatementRow[]`: one row per contact/company with a bucket
 * total in every column, an expandable `children` list of the documents
 * behind it (`ui-plan.md` §2.5's drill-down - `sourceType`/`badge`/`recordId`
 * carried through for the page to wire the drawer and the A/P status flag),
 * and a final total row.
 *
 * Group rows are `kind: 'line'`, not `'section'`: a section row renders no
 * value cells at all (`StatementTable`'s own contract), and a contact row
 * MUST show its bucket totals per `ui-plan.md` §2.5 - `'line'` is what gets
 * both the value cells and the same expand/collapse chevron a section would.
 */
export function toAgingRows(aging: Aging): StatementRow[] {
  const groupRows: StatementRow[] = aging.groups.map((group) => ({
    id: group.groupId,
    label: group.groupName,
    depth: 0,
    kind: 'line',
    values: bucketValues(group.bucketTotals, group.totalMinor),
    children: group.documents.map((doc) => {
      const label = doc.dueDate ? `${doc.label} due ${doc.dueDate}` : doc.label
      const meta =
        doc.recordId || doc.badge || doc.issuedAt
          ? {
              recordId: doc.recordId,
              badge: doc.badge,
              note: doc.issuedAt ? `Issued ${doc.issuedAt}` : undefined,
            }
          : undefined
      return {
        id: `${group.groupId}:${doc.sourceType}:${doc.sourceId}`,
        label,
        depth: 1,
        kind: 'line',
        values: documentValues(doc),
        meta,
      }
    }),
  }))

  return [
    ...groupRows,
    totalRow('total', 'Total', bucketValues(aging.bucketTotals, aging.totalMinor)),
  ]
}

export { BUCKET_LABELS as AGING_BUCKET_LABELS }
