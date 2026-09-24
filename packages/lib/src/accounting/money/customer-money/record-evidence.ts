// packages/lib/src/accounting/money/customer-money/record-evidence.ts
import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { isAccountingActive } from '../../ledger/setup/accounting-enabled'
import { wakeSources } from '../../work-items/wake'
import { upsertWorkItem } from '../../work-items/write'
import { customerMoneyObservationSchema, orderPaymentEvidenceSchema } from './contracts'
import { materializeImportedMoneyInTx } from './ingest'
import type { FinancialWriteProvenance } from './record-storage'
import { readStoredCustomerMoneyObservation } from './source-observation-adapter'
import { readOrderCoverageRow } from './source-reads'
import {
  countOrderAcceptanceStates,
  insertObservations,
  refreshOrderCoverageCountsForOrders,
  upsertAcceptances,
  upsertCoverage,
  upsertSourceAccounts,
  upsertSourceObjects,
} from './source-writes'

/** Source versions order updates; replay timestamps and unchanged raw formatting do not. */
export function shouldPromoteOrderObservation(
  previous: { payload: unknown; sourceUpdatedAt?: string | null },
  next: { payload: unknown; sourceUpdatedAt: string | null }
) {
  const oldTime = previous.sourceUpdatedAt ? Date.parse(previous.sourceUpdatedAt) : null
  const newTime = next.sourceUpdatedAt ? Date.parse(next.sourceUpdatedAt) : null
  if (oldTime !== null && (newTime === null || newTime < oldTime)) return false
  const basis = (payload: unknown) => {
    const parsed = readStoredCustomerMoneyObservation(payload)
    if (!parsed.success) return payload
    const { raw: _raw, version: _version, ...facts } = parsed.data
    return facts
  }
  if (accountingBasisHash(basis(previous.payload)) === accountingBasisHash(basis(next.payload)))
    return true
  return oldTime !== null && newTime !== null && newTime > oldTime
}

/** Ordinary order writes stage financial facts atomically; post-integrity events create money later. */
export async function stageOrderPaymentEvidenceInTx(
  tx: Transaction,
  input: {
    organizationId: string
    orderInstanceId: string
    evidence: unknown
    provenance?: FinancialWriteProvenance
  }
) {
  const evidence = orderPaymentEvidenceSchema.parse(input.evidence)
  await withAccountingCommitLock(tx, input.organizationId)
  const owner = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, input.organizationId),
        eq(schema.EntityInstance.id, input.orderInstanceId),
        eq(schema.EntityDefinition.entityType, 'order'),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!owner.length)
    throw new UnprocessableEntityError(
      'Payment evidence owner must be an active order in this organization'
    )
  const groups = new Map<'live' | 'test', unknown[]>()
  for (const raw of evidence.transactions) {
    const environment =
      raw && typeof raw === 'object' && 'test' in raw && raw.test === true
        ? 'test'
        : evidence.sourceAccount.environment
    const rows = groups.get(environment) ?? []
    rows.push(raw)
    groups.set(environment, rows)
  }
  if (!groups.size) groups.set(evidence.sourceAccount.environment, [])
  for (const [environment, rows] of groups) {
    const [account] = await upsertSourceAccounts(tx, input.organizationId, [
      { ...evidence.sourceAccount, environment },
    ])
    const previousCoverage = await readOrderCoverageRow(tx, input.organizationId, {
      sourceAccountId: account!.id,
      orderInstanceId: input.orderInstanceId,
    })
    const coverageTime = (
      previousCoverage?.fetchedBoundary as { sourceUpdatedAt?: string | null } | undefined
    )?.sourceUpdatedAt
    const oldCoverage =
      !!coverageTime &&
      (!evidence.sourceUpdatedAt || Date.parse(evidence.sourceUpdatedAt) < Date.parse(coverageTime))
    const prepared = rows.map((raw, index) => {
      const parsed = customerMoneyObservationSchema.safeParse(raw)
      return {
        raw,
        parsed,
        externalId: parsed.success
          ? parsed.data.id
          : `invalid:${evidence.orderExternalId}:${accountingBasisHash(raw)}:${index}`,
      }
    })
    const unique = new Map<string, (typeof prepared)[number]>()
    for (const row of prepared) {
      const prior = unique.get(row.externalId)
      if (prior && accountingBasisHash(prior.raw) !== accountingBasisHash(row.raw))
        throw new ConflictError(
          'One source transaction has conflicting observations in the same order write'
        )
      unique.set(row.externalId, row)
    }
    const objects = await upsertSourceObjects(
      tx,
      input.organizationId,
      [...unique.values()].map((row) => ({
        sourceAccountId: account!.id,
        objectType: 'order_transaction',
        externalId: row.externalId,
        componentKey: '',
      }))
    )
    const prior = objects.length
      ? await tx
          .select({
            acceptance: schema.FinancialSourceAcceptance,
            observation: schema.FinancialSourceObservation,
          })
          .from(schema.FinancialSourceAcceptance)
          .innerJoin(
            schema.FinancialSourceObservation,
            eq(schema.FinancialSourceObservation.id, schema.FinancialSourceAcceptance.observationId)
          )
          .where(
            and(
              eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
              inArray(
                schema.FinancialSourceAcceptance.sourceObjectId,
                objects.map((x) => x.id)
              )
            )
          )
      : []
    const previous = new Map(prior.map((row) => [row.acceptance.sourceObjectId, row]))
    const observations = await insertObservations(
      tx,
      input.organizationId,
      objects.map((object) => {
        const row = unique.get(object.externalId)!
        return {
          sourceObjectId: object.id,
          contentHash: accountingBasisHash({
            payload: row.raw,
            sourceUpdatedAt: evidence.sourceUpdatedAt,
          }),
          observedAt: new Date(),
          payload: row.raw,
          reportingInstallationSnapshot: {
            ...input.provenance,
            orderInstanceId: input.orderInstanceId,
            orderExternalId: evidence.orderExternalId,
            sourceUpdatedAt: evidence.sourceUpdatedAt,
          },
        }
      })
    )
    const observationByObject = new Map(observations.map((row) => [row.sourceObjectId, row]))
    const updates: Omit<typeof schema.FinancialSourceAcceptance.$inferInsert, 'organizationId'>[] =
      []
    const changed = new Set<string>()
    const rejected = new Set<string>()
    let stale = oldCoverage
    for (const object of objects) {
      const row = unique.get(object.externalId)!,
        old = previous.get(object.id),
        observation = observationByObject.get(object.id)!
      if (
        old &&
        (old.acceptance.orderExternalId !== evidence.orderExternalId ||
          (old.acceptance.orderInstanceId &&
            old.acceptance.orderInstanceId !== input.orderInstanceId))
      )
        throw new ConflictError('A source transaction cannot move to another order')
      const oldDate = (
        old?.observation.reportingInstallationSnapshot as
          | { sourceUpdatedAt?: string | null }
          | undefined
      )?.sourceUpdatedAt
      if (
        old &&
        !shouldPromoteOrderObservation(
          { payload: old.observation.payload, sourceUpdatedAt: oldDate },
          { payload: row.raw, sourceUpdatedAt: evidence.sourceUpdatedAt }
        )
      ) {
        stale = true
        continue
      }
      const unchanged = old?.observation.id === observation.id
      updates.push({
        sourceObjectId: object.id,
        observationId: observation.id,
        orderExternalId: evidence.orderExternalId,
        orderInstanceId: input.orderInstanceId,
        state: unchanged ? old.acceptance.state : row.parsed.success ? 'pending' : 'rejected',
        unresolvedReferences: {
          ...input.provenance,
          creditMemoInstanceId: row.parsed.success ? row.parsed.data.creditMemoInstanceId : null,
        },
        updatedAt: new Date(),
      })
      if (!unchanged) (row.parsed.success ? changed : rejected).add(object.id)
    }
    const upserted = await upsertAcceptances(tx, input.organizationId, updates)
    // A changed observation is due now; an unparseable one is a visible rejection.
    const idsOf = (objects: Set<string>) =>
      upserted.filter((row) => objects.has(row.sourceObjectId)).map((row) => row.id)
    await wakeSources(tx, input.organizationId, {
      sourceKind: 'financial_source_acceptance',
      sourceIds: idsOf(changed),
      stage: 'evidence',
    })
    for (const acceptanceId of idsOf(rejected))
      await upsertWorkItem(tx, input.organizationId, {
        sourceKind: 'financial_source_acceptance',
        sourceId: acceptanceId,
        stage: 'evidence',
        reasonCode: 'INVALID_EVIDENCE',
        externalRef: evidence.orderExternalId,
      })
    if (stale) continue
    const [retained] = await countOrderAcceptanceStates(tx, input.organizationId, {
      orderInstanceIds: [input.orderInstanceId],
      sourceAccountId: account!.id,
    })
    const { fetchedCount, acceptedCount, rejectedCount, pendingCount } = retained ?? {
      fetchedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      pendingCount: 0,
    }
    const sourceComplete = evidence.complete && unique.size === fetchedCount
    const values = {
      sourceAccountId: account!.id,
      streamKey: 'order_transactions',
      windowKey: input.orderInstanceId,
      requestedBoundary: {
        orderExternalId: evidence.orderExternalId,
        orderInstanceId: input.orderInstanceId,
      },
      fetchedBoundary: {
        sourceUpdatedAt: evidence.sourceUpdatedAt,
        sourceComplete,
        orderInstanceId: input.orderInstanceId,
      },
      fetchedCount,
      acceptedCount,
      rejectedCount,
      pendingCount,
      complete: sourceComplete && pendingCount === 0 && rejectedCount === 0,
      updatedAt: new Date(),
    }
    await upsertCoverage(tx, input.organizationId, [values])
  }
}

/** Reconcile bounded affected orders after their relationships and totals have completed. */
export async function reconcileOrderPaymentEvidence(
  db: Database,
  input: { organizationId: string; orderInstanceIds: string[] }
) {
  if (!(await isAccountingActive(input.organizationId))) return { examined: 0 }
  const ids = [...new Set(input.orderInstanceIds)]
  let examined = 0
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100)
    // Existing money acceptance remains transactional per movement. Fetch the affected set once.
    let after: string | undefined
    while (true) {
      const pending = await db.query.FinancialSourceAcceptance.findMany({
        where: and(
          eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
          inArray(schema.FinancialSourceAcceptance.orderInstanceId, chunk),
          inArray(schema.FinancialSourceAcceptance.state, ['pending', 'blocked']),
          after ? gt(schema.FinancialSourceAcceptance.id, after) : undefined
        ),
        orderBy: asc(schema.FinancialSourceAcceptance.id),
        limit: 100,
      })
      if (!pending.length) break
      for (const row of pending) {
        await db.transaction(async (tx) => {
          await materializeImportedMoneyInTx(tx, input.organizationId, row.id)
        })
        examined++
      }
      after = pending.at(-1)!.id
    }
    await refreshOrderPaymentCoverage(db, input.organizationId, chunk)
  }
  return { examined }
}

/** Refresh coverage in sets; unprocessed or rejected observations keep the order incomplete. */
export async function refreshOrderPaymentCoverage(
  db: Database | Transaction,
  organizationId: string,
  orderInstanceIds: string[]
) {
  await refreshOrderCoverageCountsForOrders(db, organizationId, orderInstanceIds)
}
