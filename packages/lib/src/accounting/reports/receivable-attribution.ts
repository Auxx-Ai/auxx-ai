// packages/lib/src/accounting/reports/receivable-attribution.ts
//
// Per-document netting of a control account (A/R, A/P), shared by aging and the
// statements' receivable split (91 §4.1, §4.3). A money line is sourced on its
// movement; the documents it pays are read through `MoneyApplication`, never the line.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toMinor } from '@auxx/utils/currency'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { readFieldRelations } from '../../field-values/read-field-scalars'
import { systemFieldMap } from '../../resources/system-records'
import { getOrganizationSetting } from '../../settings/settings-service'
import { CREDIT_MEMO_SOURCE_TYPE } from '../ledger/builders/credit-memo'
import { standingLineFilter } from '../ledger/reads/standing-lines'
import { OPENING_BASELINE_SETTING_KEYS } from '../ledger/setup/setup-readiness'

const logger = createScopedLogger('postings:reports:receivable-attribution')

/** A receipt's or refund's control line is sourced on its movement (`money/post-movement.ts`). */
const MOVEMENT_SOURCE_TYPE = 'money_transaction'

/** One source's debit and credit totals on the control account. */
export interface SourceTotal {
  sourceType: string
  sourceId: string
  debitMinor: number
  creditMinor: number
  docNumber: string
}

/** A document one movement is applied to, weighted by the live applied amount. */
export interface MovementTarget {
  sourceType: string
  sourceId: string
  weightMinor: number
}

/** What {@link attributeToDocuments} needs beyond the lines themselves. */
export interface AttributionLinks {
  /** Keyed by `MoneyTransaction.id`. */
  movementTargets: Map<string, MovementTarget[]>
  /** `sourceType:sourceId` of a source folded into another document (a memo into its order). */
  parents: Map<string, { sourceType: string; sourceId: string }>
}

/** `sourceType:sourceId`, the one document key every read here groups on. */
export function documentKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`
}

/**
 * Split `total` across `weights`: each weight in full when they fit, else pro rata with
 * the cents handed out by largest remainder so the parts sum to `total` exactly.
 */
export function allocateByWeight(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0)
  if (sum <= total) return [...weights]
  // BigInt: amount x weight can pass 2^53 on large books.
  const big = BigInt(total)
  const bigSum = BigInt(sum)
  const parts = weights.map((w) => (big * BigInt(w)) / bigSum)
  const remainders = weights.map((w, i) => ({ i, r: (big * BigInt(w)) % bigSum }))
  let left = total - parts.reduce((acc, p) => acc + Number(p), 0)
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))
  const out = parts.map(Number)
  for (const { i } of remainders) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }
  return out
}

/**
 * Net each source into the document it belongs to. A movement's net is attributed to its
 * applied documents (prorated when they exceed it); what no application covers stays on
 * the movement's own key, which the callers read as unapplied. Totals are preserved.
 */
export function attributeToDocuments(
  sources: readonly SourceTotal[],
  links: AttributionLinks
): SourceTotal[] {
  const docs = new Map<string, SourceTotal>()
  const add = (sourceType: string, sourceId: string, debit: number, credit: number, doc = '') => {
    const parent = links.parents.get(documentKey(sourceType, sourceId))
    const type = parent?.sourceType ?? sourceType
    const id = parent?.sourceId ?? sourceId
    const key = documentKey(type, id)
    let accum = docs.get(key)
    if (!accum) {
      accum = { sourceType: type, sourceId: id, debitMinor: 0, creditMinor: 0, docNumber: doc }
      docs.set(key, accum)
    }
    accum.debitMinor += debit
    accum.creditMinor += credit
    if (!accum.docNumber) accum.docNumber = doc
  }

  for (const source of sources) {
    const net = source.debitMinor - source.creditMinor
    const targets =
      source.sourceType === MOVEMENT_SOURCE_TYPE ? links.movementTargets.get(source.sourceId) : null
    if (!targets || targets.length === 0 || net === 0) {
      add(
        source.sourceType,
        source.sourceId,
        source.debitMinor,
        source.creditMinor,
        source.docNumber
      )
      continue
    }
    const open = Math.abs(net)
    const shares = allocateByWeight(
      open,
      targets.map((t) => t.weightMinor)
    )
    let attributed = 0
    targets.forEach((target, i) => {
      const share = shares[i] ?? 0
      if (share === 0) return
      attributed += share
      add(target.sourceType, target.sourceId, net > 0 ? share : 0, net < 0 ? share : 0)
    })
    const rest = open - attributed
    if (rest > 0)
      add(
        source.sourceType,
        source.sourceId,
        net > 0 ? rest : 0,
        net < 0 ? rest : 0,
        source.docNumber
      )
  }
  return [...docs.values()]
}

const CHUNK = 1000

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

interface ApplicationRow {
  id: string
  moneyTransactionId: string
  operation: 'apply' | 'unapply'
  amountMinor: bigint
  orderInstanceId: string | null
  invoiceInstanceId: string | null
  vendorBillInstanceId: string | null
  reversesApplicationId: string | null
  effectiveDate: string
}

const APPLICATION_COLUMNS = {
  id: schema.MoneyApplication.id,
  moneyTransactionId: schema.MoneyApplication.moneyTransactionId,
  operation: schema.MoneyApplication.operation,
  amountMinor: schema.MoneyApplication.amountMinor,
  orderInstanceId: schema.MoneyApplication.orderInstanceId,
  invoiceInstanceId: schema.MoneyApplication.invoiceInstanceId,
  vendorBillInstanceId: schema.MoneyApplication.vendorBillInstanceId,
  reversesApplicationId: schema.MoneyApplication.reversesApplicationId,
  effectiveDate: schema.MoneyApplication.effectiveDate,
}

function applicationDocument(row: ApplicationRow): { sourceType: string; sourceId: string } | null {
  if (row.orderInstanceId) return { sourceType: 'order', sourceId: row.orderInstanceId }
  if (row.invoiceInstanceId) return { sourceType: 'invoice', sourceId: row.invoiceInstanceId }
  if (row.vendorBillInstanceId)
    return { sourceType: 'vendor_bill', sourceId: row.vendorBillInstanceId }
  return null
}

/** `apply` rows no `unapply` has reversed. */
function liveApplications(rows: readonly ApplicationRow[]): ApplicationRow[] {
  const reversed = new Set(
    rows.flatMap((r) => (r.reversesApplicationId ? [r.reversesApplicationId] : []))
  )
  return rows.filter((r) => r.operation === 'apply' && !reversed.has(r.id))
}

async function readMovementTargets(
  db: Database,
  organizationId: string,
  movementIds: readonly string[]
): Promise<Map<string, MovementTarget[]>> {
  const out = new Map<string, MovementTarget[]>()
  if (movementIds.length === 0) return out
  const rows: ApplicationRow[] = []
  for (const chunk of chunks(movementIds)) {
    rows.push(
      ...((await db
        .select(APPLICATION_COLUMNS)
        .from(schema.MoneyApplication)
        .where(
          and(
            eq(schema.MoneyApplication.organizationId, organizationId),
            inArray(schema.MoneyApplication.moneyTransactionId, chunk)
          )
        )) as ApplicationRow[])
    )
  }
  const byMovement = new Map<string, Map<string, MovementTarget>>()
  for (const row of liveApplications(rows)) {
    const doc = applicationDocument(row)
    if (!doc) continue
    let targets = byMovement.get(row.moneyTransactionId)
    if (!targets) {
      targets = new Map()
      byMovement.set(row.moneyTransactionId, targets)
    }
    const key = documentKey(doc.sourceType, doc.sourceId)
    const target = targets.get(key) ?? { ...doc, weightMinor: 0 }
    target.weightMinor += Number(row.amountMinor)
    targets.set(key, target)
  }
  for (const [movementId, targets] of byMovement) {
    // Sorted so the cent a proration hands out lands on the same document every read.
    const list = [...targets.values()]
      .filter((t) => t.weightMinor > 0)
      .sort((a, b) =>
        documentKey(a.sourceType, a.sourceId).localeCompare(documentKey(b.sourceType, b.sourceId))
      )
    if (list.length > 0) out.set(movementId, list)
  }
  return out
}

/**
 * The links {@link attributeToDocuments} needs for `sources`: each movement's live
 * applications, a refund with none through its settlements (the memo's document, else
 * the original receipt's applications), and each credit memo's order or invoice.
 */
export async function readAttributionLinks(
  db: Database,
  organizationId: string,
  sources: readonly SourceTotal[]
): Promise<Result<AttributionLinks, Error>> {
  try {
    const movementIds = sources
      .filter((s) => s.sourceType === MOVEMENT_SOURCE_TYPE && s.debitMinor !== s.creditMinor)
      .map((s) => s.sourceId)
    const movementTargets = await readMovementTargets(db, organizationId, movementIds)

    const memoIds = new Set(
      sources.filter((s) => s.sourceType === CREDIT_MEMO_SOURCE_TYPE).map((s) => s.sourceId)
    )

    const unlinked = movementIds.filter((id) => !movementTargets.has(id))
    if (unlinked.length > 0) {
      const settlements: Array<{
        refundTransactionId: string
        originalTransactionId: string | null
        customerCreditMemoInstanceId: string | null
        amountMinor: bigint
      }> = []
      for (const chunk of chunks(unlinked)) {
        settlements.push(
          ...(await db
            .select({
              refundTransactionId: schema.MoneyRefundSettlement.refundTransactionId,
              originalTransactionId: schema.MoneyRefundSettlement.originalTransactionId,
              customerCreditMemoInstanceId:
                schema.MoneyRefundSettlement.customerCreditMemoInstanceId,
              amountMinor: schema.MoneyRefundSettlement.amountMinor,
            })
            .from(schema.MoneyRefundSettlement)
            .where(
              and(
                eq(schema.MoneyRefundSettlement.organizationId, organizationId),
                inArray(schema.MoneyRefundSettlement.refundTransactionId, chunk)
              )
            ))
        )
      }
      const originalIds = [
        ...new Set(
          settlements
            .filter((s) => !s.customerCreditMemoInstanceId && s.originalTransactionId)
            .map((s) => s.originalTransactionId as string)
        ),
      ]
      const originalTargets = await readMovementTargets(db, organizationId, originalIds)
      for (const settlement of settlements) {
        const targets = movementTargets.get(settlement.refundTransactionId) ?? []
        if (settlement.customerCreditMemoInstanceId) {
          memoIds.add(settlement.customerCreditMemoInstanceId)
          targets.push({
            sourceType: CREDIT_MEMO_SOURCE_TYPE,
            sourceId: settlement.customerCreditMemoInstanceId,
            weightMinor: Number(settlement.amountMinor),
          })
        } else if (settlement.originalTransactionId) {
          for (const t of originalTargets.get(settlement.originalTransactionId) ?? [])
            targets.push({ ...t })
        }
        if (targets.length > 0) movementTargets.set(settlement.refundTransactionId, targets)
      }
    }

    const parents = new Map<string, { sourceType: string; sourceId: string }>()
    if (memoIds.size > 0) {
      const cf = await systemFieldMap(db, organizationId, [
        'credit_memo_order',
        'credit_memo_invoice',
      ] as const)
      const orderField = cf.credit_memo_order?.id
      const invoiceField = cf.credit_memo_invoice?.id
      const relations = await readFieldRelations(
        db,
        organizationId,
        [...memoIds],
        [orderField, invoiceField].filter((id): id is string => !!id)
      )
      for (const memoId of memoIds) {
        const related = relations.get(memoId)
        const orderId = orderField ? related?.get(orderField) : undefined
        const invoiceId = invoiceField ? related?.get(invoiceField) : undefined
        if (orderId)
          parents.set(documentKey(CREDIT_MEMO_SOURCE_TYPE, memoId), {
            sourceType: 'order',
            sourceId: orderId,
          })
        else if (invoiceId)
          parents.set(documentKey(CREDIT_MEMO_SOURCE_TYPE, memoId), {
            sourceType: 'invoice',
            sourceId: invoiceId,
          })
      }
    }

    return ok({ movementTargets, parents })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read attribution links', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * The documents among `documentIds` whose live applications all fall on or before
 * `accounting.cutoffPeriod` - money the opening entry already carries by account (91 §8.7).
 * A document with no live application is never pre-cutover.
 */
export async function readPreCutoverDocumentIds(
  db: Database,
  organizationId: string,
  documentIds: readonly string[]
): Promise<Result<Set<string>, Error>> {
  const out = new Set<string>()
  if (documentIds.length === 0) return ok(out)
  try {
    const cutoff = await getOrganizationSetting({
      organizationId,
      key: OPENING_BASELINE_SETTING_KEYS.cutoffPeriod,
    })
    const cutoffMonth = typeof cutoff === 'string' ? cutoff.trim() : ''
    if (!cutoffMonth) return ok(out)

    const rows: ApplicationRow[] = []
    for (const chunk of chunks(documentIds)) {
      rows.push(
        ...((await db
          .select(APPLICATION_COLUMNS)
          .from(schema.MoneyApplication)
          .where(
            and(
              eq(schema.MoneyApplication.organizationId, organizationId),
              or(
                inArray(schema.MoneyApplication.orderInstanceId, chunk),
                inArray(schema.MoneyApplication.invoiceInstanceId, chunk),
                inArray(schema.MoneyApplication.vendorBillInstanceId, chunk)
              )
            )
          )) as ApplicationRow[])
      )
    }

    const allBefore = new Map<string, boolean>()
    for (const row of liveApplications(rows)) {
      const doc = applicationDocument(row)
      if (!doc) continue
      const before = String(row.effectiveDate).slice(0, 7) <= cutoffMonth
      allBefore.set(doc.sourceId, (allBefore.get(doc.sourceId) ?? true) && before)
    }
    for (const [id, before] of allBefore) if (before) out.add(id)
    return ok(out)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read pre-cutover documents', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/** A receivable account's balance split per document (91 D3); `receivableMinor - depositsMinor` is its balance. */
export interface ReceivableSplit {
  /** Documents netting to a debit. */
  receivableMinor: number
  /** Documents netting to a credit, as a positive amount - shown as customer deposits. */
  depositsMinor: number
}

/**
 * Each receivable account's balance over `[from, to]`, netted per document through
 * {@link attributeToDocuments}. Posts nothing; the account's own balance is unchanged.
 */
export async function readReceivableSplits(
  db: Database,
  organizationId: string,
  params: { from?: string; to: string; glAccountIds: readonly string[] }
): Promise<Result<Map<string, ReceivableSplit>, Error>> {
  const out = new Map<string, ReceivableSplit>()
  if (params.glAccountIds.length === 0) return ok(out)
  try {
    const grouped = await db
      .select({
        glAccountId: schema.GlPostingLine.glAccountId,
        sourceType: schema.GlPostingLine.sourceType,
        sourceId: schema.GlPostingLine.sourceId,
        debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
        creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(
        standingLineFilter(organizationId, {
          from: params.from,
          to: params.to,
          glAccountIds: params.glAccountIds,
        })
      )
      .groupBy(
        schema.GlPostingLine.glAccountId,
        schema.GlPostingLine.sourceType,
        schema.GlPostingLine.sourceId
      )

    const byAccount = new Map<string, SourceTotal[]>()
    for (const row of grouped) {
      const list = byAccount.get(row.glAccountId) ?? []
      list.push({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        debitMinor: toMinor(row.debitMinor),
        creditMinor: toMinor(row.creditMinor),
        docNumber: '',
      })
      byAccount.set(row.glAccountId, list)
    }

    const links = await readAttributionLinks(db, organizationId, [...byAccount.values()].flat())
    if (links.isErr()) return err(links.error)

    for (const [glAccountId, sources] of byAccount) {
      const split: ReceivableSplit = { receivableMinor: 0, depositsMinor: 0 }
      for (const doc of attributeToDocuments(sources, links.value)) {
        const net = doc.debitMinor - doc.creditMinor
        if (net > 0) split.receivableMinor += net
        else split.depositsMinor -= net
      }
      out.set(glAccountId, split)
    }
    return ok(out)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to split receivables', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}
