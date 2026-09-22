// packages/lib/src/accounting/reports/aging.ts
//
// A/R and A/P aging (plans/accounting/HANDOFF.md slot 2H; tasks/05-aging.md).
// Built from the GL, not the subledger: task 05 §1 is explicit that a
// subledger aging that does not tie to the balance sheet's own A/R or A/P is
// the single most common "my accounting software is lying to me" complaint,
// and it is unfixable after the fact because the two numbers have different
// definitions. So this reads posted `accounts_receivable`/`accounts_payable`
// lines on every receivable/payable account (the role's default plus every
// account whose subtype says so, which covers A/R's per-store accounts), groups
// them by the DOCUMENT their `sourceType`/`sourceId` names (netting debits and
// credits per document as of `asOf`), and asserts its own total against the sum
// of `readTrialBalance`'s rows for those accounts - the `verdict`, shown even
// when it is false.
//
// BUCKETING. Always on the document's DUE DATE, never on issue date (task 05
// §3): a net-60 invoice issued 45 days ago is `current`, not `31-60`. A
// document with no due date - an unapplied payment, a manual adjustment, the
// opening entry - has nothing to bucket on and is always `current`.
//
// DOCUMENT SOURCES. `invoice` and `vendor_bill` age on their due date; `order`
// (a shipment) carries none. A `money_transaction` line (receipt, refund,
// vendor payment) is attributed to the documents its `MoneyApplication`s name,
// prorated, and a `credit_memo` folds into its order or invoice - see
// `receivable-attribution.ts`. What stays on a movement is unapplied. That,
// `journal_entry` and any unknown source land in the catch-all, so the total
// still ties. A document paid only before `accounting.cutoffPeriod` groups as
// pre-cutover: the opening entry carries that money by account (91 §8.7).
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId } from '../../cache'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { readFieldRelations, readFieldScalars } from '../../field-values/read-field-scalars'
import { systemFieldMap } from '../../resources/system-records'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { standingLineFilter } from '../ledger/reads/standing-lines'
import { loadRoleAccountCodes } from '../ledger/roles/resolve-roles'
import {
  attributeToDocuments,
  readAttributionLinks,
  readPreCutoverDocumentIds,
} from './receivable-attribution'
import { type StatementColumn, type StatementRow, totalRow } from './rows'
import { signedBalance } from './statement-math'
import { readTrialBalance } from './trial-balance'

const logger = createScopedLogger('postings:reports:aging')

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
  /** `awaiting_receipt` | `exception`, the match verdict on a payable; absent otherwise. */
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
  /** The code of the role's org-default account, or `null` when that is unmapped. */
  accountCode: string | null
  groups: AgingGroup[]
  bucketTotals: Record<AgingBucketKey, number>
  totalMinor: number
  /** The sum of `readTrialBalance`'s rows for every account walked, as of the same date. */
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

/** Documents whose every application predates the cutoff (91 §8.7). */
export const AGING_PRE_CUTOVER_GROUP_ID = 'pre_cutover'
const PRE_CUTOVER_GROUP_NAME = 'Paid before cutover'

const SYNTHETIC_GROUPS = new Map([
  [AGING_UNAPPLIED_GROUP_ID, UNAPPLIED_GROUP_NAME],
  [AGING_PRE_CUTOVER_GROUP_ID, PRE_CUTOVER_GROUP_NAME],
])

const MOVEMENT_SOURCE_TYPE = 'money_transaction'

const DOCUMENT_SCALAR_ATTRIBUTES = [
  'invoice_due_date',
  'invoice_issued_at',
  'invoice_number',
  'vendor_bill_due_at',
  'vendor_bill_number',
  'vendor_bill_match_status',
  'order_number',
] as const

const DOCUMENT_RELATION_ATTRIBUTES = [
  'invoice_contact',
  'vendor_bill_vendor',
  'order_contact',
  'order_company',
] as const

/**
 * The two MATCH verdicts task 05 §0 (via the review) says an open payable may
 * carry and never be dropped for. The lifecycle says nothing an aging row needs
 * — an open payable is posted by definition (73 D1).
 */
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
 * Walks the side's role default ({@link loadRoleAccountCodes}) plus every account
 * carrying the side's subtype - a store-scoped A/R account is pinned to it
 * (`ROLE_ACCOUNT_SUBTYPES`). No account at all is an empty, trivially tied aging.
 *
 * Every posted line against those accounts, through `asOf`, is grouped by the
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
  const subtype = side === 'receivable' ? 'accounts_receivable' : 'accounts_payable'

  try {
    const account = (await loadRoleAccountCodes(db, organizationId, [role])).get(role)
    const tbResult = await readTrialBalance(db, { organizationId, to: asOf })
    if (tbResult.isErr()) return err(tbResult.error)
    const accountIds = new Set(
      tbResult.value.rows.filter((row) => row.subtype === subtype).map((row) => row.glAccountId)
    )
    if (account) accountIds.add(account.glAccountId)
    // "Absent rather than failed", the same rule `vendor-1099.ts`'s `emptySummary` follows.
    if (accountIds.size === 0) return ok(emptyAging(options, null))
    const accountType = account?.accountType ?? (side === 'receivable' ? 'asset' : 'liability')

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
      // By id (task 15), not by code: a renumber of the A/R or A/P account
      // between two postings must not split its open documents in two.
      .where(
        standingLineFilter(organizationId, {
          to: asOf,
          glAccountIds: [...accountIds],
        })
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
          // Non-null: `POSTED_STATUSES` above always carries a doc number.
          docNumber: line.docNumber ?? '',
        }
        byDoc.set(key, accum)
      }
      if (line.direction === 'debit') accum.debitMinor += line.amountMinor
      else accum.creditMinor += line.amountMinor
    }

    const links = await readAttributionLinks(db, organizationId, [...byDoc.values()])
    if (links.isErr()) return err(links.error)

    const openDocs = attributeToDocuments([...byDoc.values()], links.value)
      .map((accum) => ({
        accum,
        openMinor: signedBalance(accum.debitMinor, accum.creditMinor, accountType),
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
      .filter((d) => d.accum.sourceType === MOVEMENT_SOURCE_TYPE)
      .map((d) => d.accum.sourceId)
    const preCutover = await readPreCutoverDocumentIds(db, organizationId, fieldDocumentIds)
    if (preCutover.isErr()) return err(preCutover.error)

    const cf = await systemFieldMap(db, organizationId, [
      ...DOCUMENT_SCALAR_ATTRIBUTES,
      ...DOCUMENT_RELATION_ATTRIBUTES,
    ])

    const scalarFieldIds = [
      cf.invoice_due_date?.id,
      cf.invoice_issued_at?.id,
      cf.invoice_number?.id,
      cf.vendor_bill_due_at?.id,
      cf.vendor_bill_number?.id,
      cf.vendor_bill_match_status?.id,
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
                id: schema.MoneyTransaction.id,
                reference: schema.MoneyTransaction.reference,
                purpose: schema.MoneyTransaction.purpose,
              })
              .from(schema.MoneyTransaction)
              .where(
                and(
                  eq(schema.MoneyTransaction.organizationId, organizationId),
                  inArray(schema.MoneyTransaction.id, paymentTransactionIds)
                )
              )
          : Promise.resolve([]),
        side === 'receivable' ? getCachedEntityDefId(organizationId, 'invoice') : undefined,
        side === 'payable' ? getCachedEntityDefId(organizationId, 'vendor_bill') : undefined,
      ])
    const paymentById = new Map(paymentTransactions.map((p) => [p.id, p]))

    const resolveDocument = (doc: (typeof openDocs)[number]): ResolvedDocument => {
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
        const statusRaw = cf.vendor_bill_match_status
          ? scalars.get(sourceId)?.get(cf.vendor_bill_match_status.id)
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

      // What no application covers: the unapplied remainder, or a refund with no memo yet.
      if (sourceType === MOVEMENT_SOURCE_TYPE) {
        const payment = paymentById.get(sourceId)
        return {
          accum: doc.accum,
          openMinor: doc.openMinor,
          groupId: AGING_UNAPPLIED_GROUP_ID,
          label:
            payment?.reference || (payment?.purpose === 'customer_refund' ? 'Refund' : 'Payment'),
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
    }
    const resolved = openDocs.map((doc) => {
      const r = resolveDocument(doc)
      return preCutover.value.has(r.accum.sourceId)
        ? { ...r, groupId: AGING_PRE_CUTOVER_GROUP_ID }
        : r
    })

    // ── Names for every resolved contact/company ─────────────────────────
    const groupIds = [
      ...new Set(resolved.map((r) => r.groupId).filter((id) => !SYNTHETIC_GROUPS.has(id))),
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
          groupName: SYNTHETIC_GROUPS.get(r.groupId) ?? (nameById.get(r.groupId) || r.groupId),
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

    // Contacts first by name, then pre-cutover, then the catch-all.
    const rank = (id: string) =>
      id === AGING_UNAPPLIED_GROUP_ID ? 2 : id === AGING_PRE_CUTOVER_GROUP_ID ? 1 : 0
    const groups = [...groupsById.values()].sort(
      (a, b) => rank(a.groupId) - rank(b.groupId) || a.groupName.localeCompare(b.groupName)
    )
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
    const balanceSheetMinor = tbResult.value.rows
      .filter((row) => accountIds.has(row.glAccountId))
      .reduce((sum, row) => sum + row.balanceMinor, 0)
    const differenceMinor = totalMinor - balanceSheetMinor

    return ok({
      organizationId,
      side,
      asOf,
      accountCode: account?.code ?? null,
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
