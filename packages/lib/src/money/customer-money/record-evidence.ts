// packages/lib/src/money/customer-money/record-evidence.ts
import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { accountingBasisHash } from '../../accounting/ledger/builders/basis-hash'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { customerMoneyObservationSchema, orderPaymentEvidenceSchema } from './contracts'
import { materializeImportedMoneyInTx } from './ingest'
import type { FinancialWriteProvenance } from './record-storage'
import { readStoredCustomerMoneyObservation } from './source-observation-adapter'

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
    const [account] = await tx
      .insert(schema.FinancialSourceAccount)
      .values({ organizationId: input.organizationId, ...evidence.sourceAccount, environment })
      .onConflictDoUpdate({
        target: [
          schema.FinancialSourceAccount.organizationId,
          schema.FinancialSourceAccount.providerKey,
          schema.FinancialSourceAccount.externalAccountId,
          schema.FinancialSourceAccount.environment,
        ],
        set: { externalAccountId: evidence.sourceAccount.externalAccountId },
      })
      .returning()
    const previousCoverage = await tx.query.FinancialSourceCoverage.findFirst({
      where: and(
        eq(schema.FinancialSourceCoverage.organizationId, input.organizationId),
        eq(schema.FinancialSourceCoverage.sourceAccountId, account!.id),
        eq(schema.FinancialSourceCoverage.streamKey, 'order_transactions'),
        eq(schema.FinancialSourceCoverage.windowKey, input.orderInstanceId)
      ),
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
    const objects = unique.size
      ? await tx
          .insert(schema.FinancialSourceObject)
          .values(
            [...unique.values()].map((row) => ({
              organizationId: input.organizationId,
              sourceAccountId: account!.id,
              objectType: 'order_transaction',
              externalId: row.externalId,
              componentKey: '',
            }))
          )
          .onConflictDoUpdate({
            target: [
              schema.FinancialSourceObject.organizationId,
              schema.FinancialSourceObject.sourceAccountId,
              schema.FinancialSourceObject.objectType,
              schema.FinancialSourceObject.externalId,
              schema.FinancialSourceObject.componentKey,
            ],
            set: { externalId: sql`excluded."externalId"` },
          })
          .returning()
      : []
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
    const observations = objects.length
      ? await tx
          .insert(schema.FinancialSourceObservation)
          .values(
            objects.map((object) => {
              const row = unique.get(object.externalId)!
              return {
                organizationId: input.organizationId,
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
          .onConflictDoUpdate({
            target: [
              schema.FinancialSourceObservation.organizationId,
              schema.FinancialSourceObservation.sourceObjectId,
              schema.FinancialSourceObservation.contentHash,
            ],
            set: { contentHash: sql`excluded."contentHash"` },
          })
          .returning()
      : []
    const observationByObject = new Map(observations.map((row) => [row.sourceObjectId, row]))
    const updates: (typeof schema.FinancialSourceAcceptance.$inferInsert)[] = []
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
        organizationId: input.organizationId,
        sourceObjectId: object.id,
        observationId: observation.id,
        orderExternalId: evidence.orderExternalId,
        orderInstanceId: input.orderInstanceId,
        state: unchanged ? old.acceptance.state : row.parsed.success ? 'pending' : 'rejected',
        reason: unchanged
          ? old.acceptance.reason
          : row.parsed.success
            ? null
            : 'Invalid transaction identity or money evidence',
        unresolvedReferences: {
          ...input.provenance,
          creditMemoInstanceId: row.parsed.success ? row.parsed.data.creditMemoInstanceId : null,
        },
        nextAttemptAt: unchanged ? old.acceptance.nextAttemptAt : null,
        updatedAt: new Date(),
      })
    }
    if (updates.length)
      await tx
        .insert(schema.FinancialSourceAcceptance)
        .values(updates)
        .onConflictDoUpdate({
          target: [
            schema.FinancialSourceAcceptance.organizationId,
            schema.FinancialSourceAcceptance.sourceObjectId,
          ],
          set: {
            observationId: sql`excluded."observationId"`,
            orderInstanceId: sql`excluded."orderInstanceId"`,
            state: sql`excluded.state`,
            reason: sql`excluded.reason`,
            unresolvedReferences: sql`excluded."unresolvedReferences"`,
            nextAttemptAt: sql`excluded."nextAttemptAt"`,
            updatedAt: new Date(),
          },
        })
    if (stale) continue
    const retained = await tx
      .select({ state: schema.FinancialSourceAcceptance.state })
      .from(schema.FinancialSourceAcceptance)
      .innerJoin(
        schema.FinancialSourceObject,
        eq(schema.FinancialSourceObject.id, schema.FinancialSourceAcceptance.sourceObjectId)
      )
      .where(
        and(
          eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
          eq(schema.FinancialSourceAcceptance.orderInstanceId, input.orderInstanceId),
          eq(schema.FinancialSourceObject.sourceAccountId, account!.id)
        )
      )
    const acceptedCount = retained.filter((r) => r.state === 'accepted').length,
      rejectedCount = retained.filter((r) => r.state === 'rejected').length,
      pendingCount = retained.length - acceptedCount - rejectedCount
    const sourceComplete = evidence.complete && unique.size === retained.length
    const values = {
      organizationId: input.organizationId,
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
      fetchedCount: retained.length,
      acceptedCount,
      rejectedCount,
      pendingCount,
      complete: sourceComplete && pendingCount === 0 && rejectedCount === 0,
      updatedAt: new Date(),
    }
    await tx
      .insert(schema.FinancialSourceCoverage)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.FinancialSourceCoverage.organizationId,
          schema.FinancialSourceCoverage.sourceAccountId,
          schema.FinancialSourceCoverage.streamKey,
          schema.FinancialSourceCoverage.windowKey,
        ],
        set: values,
      })
  }
}

/** Reconcile bounded affected orders after their relationships and totals have completed. */
export async function reconcileOrderPaymentEvidence(
  db: Database,
  input: { organizationId: string; orderInstanceIds: string[] }
) {
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
  if (!orderInstanceIds.length) return
  await db.execute(sql`UPDATE "FinancialSourceCoverage" c SET
   "fetchedCount"=s.total,"acceptedCount"=s.accepted,"rejectedCount"=s.rejected,"pendingCount"=s.pending,
   complete=(COALESCE((c."fetchedBoundary"->>'sourceComplete')::boolean,false) AND c."fetchedCount"=s.total AND s.pending=0 AND s.rejected=0),"updatedAt"=now()
 FROM (SELECT a."orderInstanceId" AS owner,o."sourceAccountId" AS account,count(*)::int AS total,
   count(*) FILTER(WHERE a.state='accepted')::int AS accepted,count(*) FILTER(WHERE a.state='rejected')::int AS rejected,
   count(*) FILTER(WHERE a.state NOT IN ('accepted','rejected'))::int AS pending
 FROM "FinancialSourceAcceptance" a JOIN "FinancialSourceObject" o ON o.id=a."sourceObjectId" AND o."organizationId"=a."organizationId"
 WHERE a."organizationId"=${organizationId} AND a."orderInstanceId" IN (${sql.join(
   orderInstanceIds.map((id) => sql`${id}`),
   sql`,`
 )}) GROUP BY a."orderInstanceId",o."sourceAccountId")s
 WHERE c."organizationId"=${organizationId} AND c."sourceAccountId"=s.account AND c."streamKey"='order_transactions' AND c."windowKey"=s.owner`)
}
