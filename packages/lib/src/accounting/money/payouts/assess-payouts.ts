// packages/lib/src/accounting/money/payouts/assess-payouts.ts
import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { exactEvidenceMinor, isOutgoingPayoutEntry } from '../customer-money/evidence-contracts'
import {
  type PayoutRecordEvidence,
  payoutRecordEvidenceSchema,
} from '../customer-money/record-contracts'
import { type MatchableProcessorEntry, matchProcessorEntries } from './match-entries'

const OWNER_BATCH_SIZE = 100
const OBSERVATION_BATCH_SIZE = 100
type Transfer = typeof schema.MoneyTransfer.$inferSelect

/** Persisted assessment for inspection. Settlement accounting is a separate operation. */
export interface PayoutReconciliationResult {
  state: 'complete' | 'incomplete' | 'unsupported'
  providerReady: boolean
  entryCount: number
  constituentNetMinor: string | null
  differenceMinor: string | null
  reason: string | null
  blockers: string[]
  nextActions: string[]
  unmatchedCount: number
}

type Assessment = {
  transfer: Transfer
  header: PayoutRecordEvidence | null
  seen: Set<string>
  reasons: Set<string>
  unsupported: boolean
  total: bigint
  unmatchedCount: number
  entryCount: number
  matchedBasis: Array<[string, string | null]>
  observations: string[]
  pageCount: number
  coverage: typeof schema.FinancialSourceCoverage.$inferSelect | null
}

function pages(value: unknown): Array<{ id: string; index: number }> {
  if (!value || typeof value !== 'object' || !('pageObservations' in value)) return []
  const raw = value.pageObservations
  if (!Array.isArray(raw)) return []
  return raw.flatMap((page) =>
    page && typeof page.id === 'string' && Number.isInteger(page.index)
      ? [{ id: page.id, index: page.index }]
      : []
  )
}

async function assessTransfers(
  tx: Transaction,
  organizationId: string,
  transfers: Transfer[]
): Promise<number> {
  if (!transfers.length) return 0
  const observations = await tx
    .select()
    .from(schema.FinancialSourceObservation)
    .where(
      and(
        eq(schema.FinancialSourceObservation.organizationId, organizationId),
        inArray(
          schema.FinancialSourceObservation.id,
          transfers.map((row) => row.currentObservationId)
        )
      )
    )
  const observationMap = new Map(observations.map((row) => [row.id, row]))
  const assessments: Assessment[] = transfers.map((transfer) => {
    const observation = observationMap.get(transfer.currentObservationId)
    const parsed = payoutRecordEvidenceSchema.safeParse(observation?.payload)
    const header = parsed.success ? parsed.data : null
    const snapshot = observation?.reportingInstallationSnapshot
    const rejection =
      snapshot &&
      typeof snapshot === 'object' &&
      'rejectionReason' in snapshot &&
      typeof snapshot.rejectionReason === 'string'
        ? snapshot.rejectionReason
        : null
    return {
      transfer,
      header,
      seen: new Set(),
      reasons: new Set(rejection ? [rejection] : []),
      unsupported: !header?.payout || Boolean(rejection),
      total: 0n,
      unmatchedCount: 0,
      entryCount: 0,
      matchedBasis: [],
      observations: [],
      pageCount: 0,
      coverage: null,
    }
  })
  const windows = assessments.flatMap(({ header, transfer }) =>
    header ? [`payout:${transfer.externalId}:acquisition:${header.acquisition.id}`] : []
  )
  const coverages = windows.length
    ? await tx
        .select()
        .from(schema.FinancialSourceCoverage)
        .where(
          and(
            eq(schema.FinancialSourceCoverage.organizationId, organizationId),
            eq(schema.FinancialSourceCoverage.streamKey, 'payout_membership'),
            inArray(schema.FinancialSourceCoverage.sourceAccountId, [
              ...new Set(transfers.map((row) => row.sourceAccountId)),
            ]),
            inArray(schema.FinancialSourceCoverage.windowKey, windows)
          )
        )
    : []
  const coverageMap = new Map(
    coverages.map((row) => [JSON.stringify([row.sourceAccountId, row.windowKey]), row])
  )
  const pageOwners = new Map<string, Array<{ assessment: Assessment; index: number }>>()
  for (const assessment of assessments) {
    const { header, transfer } = assessment
    if (!header?.payout) {
      assessment.reasons.add('Payout header evidence is invalid or unavailable')
      continue
    }
    assessment.coverage =
      coverageMap.get(
        JSON.stringify([
          transfer.sourceAccountId,
          `payout:${transfer.externalId}:acquisition:${header.acquisition.id}`,
        ])
      ) ?? null
    if (!assessment.coverage?.complete) assessment.reasons.add('Payout membership is incomplete')
    const references = pages(assessment.coverage?.fetchedBoundary).sort((a, b) => a.index - b.index)
    if (!references.length)
      assessment.reasons.add('Payout membership has no committed page receipts')
    for (const [expectedIndex, reference] of references.entries()) {
      if (reference.index !== expectedIndex)
        assessment.reasons.add('Payout membership page chain has a gap')
      const owners = pageOwners.get(reference.id) ?? []
      owners.push({ assessment, index: reference.index })
      pageOwners.set(reference.id, owners)
      assessment.observations.push(reference.id)
    }
  }
  const pageIds = [...pageOwners.keys()]
  for (let offset = 0; offset < pageIds.length; offset += OBSERVATION_BATCH_SIZE) {
    const chunk = pageIds.slice(offset, offset + OBSERVATION_BATCH_SIZE)
    const pageRows = await tx
      .select()
      .from(schema.FinancialSourceObservation)
      .where(
        and(
          eq(schema.FinancialSourceObservation.organizationId, organizationId),
          inArray(schema.FinancialSourceObservation.id, chunk)
        )
      )
    const found = new Set(pageRows.map((row) => row.id))
    for (const id of chunk) {
      if (!found.has(id))
        for (const { assessment } of pageOwners.get(id) ?? []) {
          assessment.reasons.add('A committed payout membership observation is missing')
        }
    }
    const matchable: MatchableProcessorEntry[] = []
    const matchOwners = new Map<string, Assessment>()
    for (const row of pageRows) {
      const parsed = payoutRecordEvidenceSchema.safeParse(row.payload)
      for (const { assessment, index } of pageOwners.get(row.id) ?? []) {
        const envelope = parsed.success ? parsed.data : null
        if (
          !envelope?.payout ||
          !envelope.membership.page ||
          envelope.payout.id !== assessment.transfer.externalId ||
          envelope.acquisition.id !== assessment.header?.acquisition.id ||
          envelope.membership.page.index !== index ||
          row.sourceObjectId !== assessment.transfer.sourceObjectId ||
          JSON.stringify(envelope.sourceAccount) !==
            JSON.stringify(assessment.header?.sourceAccount)
        ) {
          assessment.reasons.add(
            'Payout membership observation does not match its owner and acquisition'
          )
          continue
        }
        assessment.pageCount++
        if (envelope.rejectionReason || envelope.membership.rejections.length) {
          assessment.reasons.add('Payout membership contains rejected source rows')
        }
        for (const entry of envelope.membership.entries) {
          if (assessment.seen.has(entry.id)) {
            assessment.reasons.add('Duplicate processor entry identity in payout membership')
            continue
          }
          assessment.seen.add(entry.id)
          assessment.entryCount++
          if (entry.payoutId !== assessment.transfer.externalId) {
            assessment.reasons.add('Processor entry belongs to another payout or is unassigned')
          }
          try {
            const gross = exactEvidenceMinor(entry.gross, entry.currency, entry.currencyExponent)
            const fee = exactEvidenceMinor(entry.fee, entry.currency, entry.currencyExponent)
            const net = exactEvidenceMinor(entry.net, entry.currency, entry.currencyExponent)
            if (gross - fee !== net)
              assessment.reasons.add('Processor gross less fees differs from its reported net')
            if (
              entry.currency !== assessment.transfer.sourceCurrency ||
              entry.currencyExponent !== assessment.transfer.sourceCurrencyExponent
            ) {
              assessment.unsupported = true
              assessment.reasons.add(
                'Processor currency differs from the payout settlement currency'
              )
            }
            if (entry.type === 'unknown' || entry.type === 'returned_transfer') {
              assessment.unsupported = true
              assessment.reasons.add('Processor activity requires separate classification')
            } else if (!isOutgoingPayoutEntry(entry.type)) assessment.total += net
            if (entry.type === 'charge' || entry.type === 'refund') {
              const id = JSON.stringify([assessment.transfer.id, row.id, entry.id])
              matchable.push({
                id,
                sourceAccountId: assessment.transfer.sourceAccountId,
                sourceReference: entry.sourceReference,
                type: entry.type,
                grossMinor: gross,
                currency: entry.currency,
                currencyExponent: entry.currencyExponent,
              })
              matchOwners.set(id, assessment)
            }
          } catch {
            assessment.unsupported = true
            assessment.reasons.add('Processor entry has invalid or unsupported money evidence')
          }
        }
      }
    }
    const matches = await matchProcessorEntries(tx, organizationId, matchable)
    for (const entry of matchable) {
      const assessment = matchOwners.get(entry.id)!
      const moneyId = matches.get(entry.id) ?? null
      assessment.matchedBasis.push([entry.id, moneyId])
      if (!moneyId) assessment.unmatchedCount++
    }
  }
  const changes = assessments.flatMap((assessment) => {
    const { transfer, header } = assessment
    const difference = transfer.sourceAmountMinor - assessment.total
    const inRange = (amount: bigint) =>
      amount >= -9223372036854775808n && amount <= 9223372036854775807n
    if (!inRange(assessment.total) || !inRange(difference)) {
      assessment.unsupported = true
      assessment.reasons.add('Payout arithmetic exceeds supported storage capacity')
    }
    const state = assessment.unsupported
      ? ('unsupported' as const)
      : assessment.reasons.size
        ? ('incomplete' as const)
        : ('complete' as const)
    const blockers = [...assessment.reasons]
    const providerReady = header?.membership.providerReady ?? false
    if (!providerReady) blockers.push('The provider has not marked this payout ready')
    if (!assessment.unsupported && difference !== 0n)
      blockers.push('Payout amount differs from constituent net')
    if (assessment.unmatchedCount)
      blockers.push(
        `${assessment.unmatchedCount} processor entries have no verified matching customer movement`
      )
    const result: PayoutReconciliationResult = {
      state,
      providerReady,
      entryCount: assessment.entryCount,
      constituentNetMinor: assessment.unsupported ? null : assessment.total.toString(),
      differenceMinor: assessment.unsupported ? null : difference.toString(),
      reason: [...assessment.reasons].join('; ') || null,
      blockers,
      nextActions: blockers.length
        ? ['Review the retained source evidence and resolve the reported prerequisites.']
        : [],
      unmatchedCount: assessment.unmatchedCount,
    }
    const basis = accountingBasisHash({
      header: transfer.currentObservationId,
      coverage: assessment.coverage
        ? {
            id: assessment.coverage.id,
            fetchedBoundary: assessment.coverage.fetchedBoundary,
            complete: assessment.coverage.complete,
            fetchedCount: assessment.coverage.fetchedCount,
            acceptedCount: assessment.coverage.acceptedCount,
            rejectedCount: assessment.coverage.rejectedCount,
            pendingCount: assessment.coverage.pendingCount,
          }
        : null,
      observations: assessment.observations,
      matches: assessment.matchedBasis.sort(),
      result,
    })
    if (basis === transfer.reconciliationBasisHash && transfer.reconciliationState === state)
      return []
    return [
      {
        ...transfer,
        reconciliationBasisHash: basis,
        reconciliationState: state,
        reconciliationResult: result,
        reconciledAt: new Date(),
      },
    ]
  })
  if (changes.length)
    await tx
      .insert(schema.MoneyTransfer)
      .values(changes)
      .onConflictDoUpdate({
        target: [schema.MoneyTransfer.organizationId, schema.MoneyTransfer.id],
        set: {
          reconciliationBasisHash: sql`excluded."reconciliationBasisHash"`,
          reconciliationState: sql`excluded."reconciliationState"`,
          reconciliationResult: sql`excluded."reconciliationResult"`,
          reconciledAt: sql`excluded."reconciledAt"`,
        },
      })
  return changes.length
}

/** Reconcile canonical transfer IDs in bounded transactions, preserving source-write serialization. */
export async function reconcileTransferIds(
  db: Database,
  organizationId: string,
  ids: string[]
): Promise<number> {
  const uniqueIds = [...new Set(ids)]
  let changed = 0
  for (let offset = 0; offset < uniqueIds.length; offset += OWNER_BATCH_SIZE) {
    const chunk = uniqueIds.slice(offset, offset + OWNER_BATCH_SIZE)
    changed += await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, organizationId)
      const transfers = await tx
        .select()
        .from(schema.MoneyTransfer)
        .where(
          and(
            eq(schema.MoneyTransfer.organizationId, organizationId),
            inArray(schema.MoneyTransfer.id, chunk)
          )
        )
      return assessTransfers(tx, organizationId, transfers)
    })
  }
  return changed
}

/**
 * Resolve affected financial owners in sets, then assess each canonical owner once.
 *
 * Takes entity INSTANCE ids, not `RecordId`s: its caller is
 * `payout-reconciler.ts`, and the dirty-parent buffer dedupes instance ids
 * because RecordIds reach it in two keyspaces (`dirty-parents.ts`).
 */
export async function assessPayouts(
  db: Database,
  organizationId: string,
  entityInstanceIds: string[]
): Promise<number> {
  const ids = [...new Set(entityInstanceIds)]
  const owners = new Set<string>()
  for (let offset = 0; offset < ids.length; offset += OWNER_BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + OWNER_BATCH_SIZE)
    const entries = await db
      .select({
        entry: schema.ProcessorBalanceEntry,
        snapshot: schema.FinancialSourceObservation.reportingInstallationSnapshot,
      })
      .from(schema.ProcessorBalanceEntry)
      .innerJoin(
        schema.FinancialSourceObservation,
        and(
          eq(
            schema.FinancialSourceObservation.organizationId,
            schema.ProcessorBalanceEntry.organizationId
          ),
          eq(
            schema.FinancialSourceObservation.id,
            schema.ProcessorBalanceEntry.currentObservationId
          )
        )
      )
      .where(
        and(
          eq(schema.ProcessorBalanceEntry.organizationId, organizationId),
          inArray(schema.ProcessorBalanceEntry.id, chunk)
        )
      )
    const previous = entries.flatMap(({ snapshot }) => {
      if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        !('affectedTransferIds' in snapshot) ||
        !Array.isArray(snapshot.affectedTransferIds)
      )
        return []
      return snapshot.affectedTransferIds.filter((id): id is string => typeof id === 'string')
    })
    const related = entries
      .filter(({ entry }) => entry.payoutExternalId)
      .map(({ entry }) =>
        and(
          eq(schema.MoneyTransfer.sourceAccountId, entry.sourceAccountId),
          eq(schema.MoneyTransfer.externalId, entry.payoutExternalId!)
        )
      )
    const transfers = await db
      .select({ id: schema.MoneyTransfer.id })
      .from(schema.MoneyTransfer)
      .where(
        and(
          eq(schema.MoneyTransfer.organizationId, organizationId),
          or(inArray(schema.MoneyTransfer.id, [...chunk, ...previous]), ...related)
        )
      )
    for (const row of transfers) owners.add(row.id)
  }
  return reconcileTransferIds(db, organizationId, [...owners])
}

/** One bounded recovery page. The caller checkpoints nextCursor before fetching another page. */
export async function recoverPayoutReconciliationPage(db: Database, cursor?: string) {
  const rows = await db
    .select({ id: schema.MoneyTransfer.id, organizationId: schema.MoneyTransfer.organizationId })
    .from(schema.MoneyTransfer)
    .where(cursor ? gt(schema.MoneyTransfer.id, cursor) : undefined)
    .orderBy(schema.MoneyTransfer.id)
    .limit(OWNER_BATCH_SIZE)
  const byOrganization = new Map<string, string[]>()
  for (const row of rows) {
    const ids = byOrganization.get(row.organizationId) ?? []
    ids.push(row.id)
    byOrganization.set(row.organizationId, ids)
  }
  let changed = 0
  for (const [organizationId, ids] of byOrganization)
    changed += await reconcileTransferIds(db, organizationId, ids)
  return { changed, nextCursor: rows.length === OWNER_BATCH_SIZE ? rows.at(-1)!.id : null }
}
