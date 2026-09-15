// packages/lib/src/money/payouts/record-storage.ts
import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { PgTransaction } from 'drizzle-orm/pg-core'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { accountingBasisHash } from '../../postings/effect-basis'
import { exactEvidenceMinor } from './evidence-contracts'
import {
  type FinancialRecordEvidence,
  type FinancialRecordType,
  type PayoutRecordEvidence,
  payoutRecordEvidenceSchema,
  processorRecordEvidenceSchema,
} from './record-contracts'
import { FinancialSourceIdentityConflictError } from './source-write-errors'

type Db = Database | Transaction
/** Canonical entity header plus typed financial extension; every intake uses these fields. */
export interface FinancialRecordWrite {
  entityType: FinancialRecordType
  entityDefinitionId: string
  recordId?: string
  evidence: FinancialRecordEvidence
}
export interface FinancialWriteProvenance {
  source: string
  ref?: string
  connectorId?: string
  credentialId?: string
  appInstallationId?: string
  credentialMetadataHash?: string
}
export interface FinancialRecordWriteResult {
  id: string
  entityDefinitionId: string
  entityType: FinancialRecordType
  instance: typeof schema.EntityInstance.$inferSelect
  created: boolean
  changed: boolean
  disposition: ReturnType<typeof financialObservationDisposition>
  observationId: string
  previousEvidence?: unknown
  evidence: FinancialRecordEvidence
}
const accountKey = (a: { providerKey: string; externalAccountId: string; environment: string }) =>
  JSON.stringify([a.providerKey, a.externalAccountId, a.environment])
const objectKey = (accountId: string, type: string, externalId: string) =>
  JSON.stringify([accountId, type, externalId])
function evidenceOf(record: FinancialRecordWrite): FinancialRecordEvidence {
  const raw = record.evidence
  return record.entityType === 'payout'
    ? payoutRecordEvidenceSchema.parse(raw)
    : processorRecordEvidenceSchema.parse(raw)
}
function externalId(e: FinancialRecordEvidence) {
  const id = e.externalId ?? ('payout' in e ? e.payout?.id : e.entry?.id)
  if (!id)
    throw new UnprocessableEntityError(
      'Source evidence requires an explicit identity, including rejected rows'
    )
  return id
}
function normalizedFailure(e: FinancialRecordEvidence): string | null {
  if (e.rejectionReason) return e.rejectionReason
  const normalizedId = 'payout' in e ? e.payout?.id : e.entry?.id
  if (e.externalId && normalizedId && e.externalId !== normalizedId)
    return 'Reported identity disagrees with normalized financial identity'
  try {
    if ('payout' in e) {
      if (!e.payout) return 'Payout normalization failed'
      exactEvidenceMinor(e.payout.amount, e.payout.currency, e.payout.currencyExponent)
      if (e.payout.issuedAt && e.payout.issuedOn) return 'Payout date precision is conflicting'
    } else {
      if (!e.entry) return 'Processor normalization failed'
      for (const amount of [e.entry.gross, e.entry.fee, e.entry.net])
        exactEvidenceMinor(amount, e.entry.currency, e.entry.currencyExponent)
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Unsupported monetary evidence'
  }
}
function position(e: FinancialRecordEvidence) {
  return [
    new Date(e.acquisition.startedAt).getTime(),
    'payout' in e ? (e.membership.page?.index ?? -1) : e.page.index,
  ] as const
}
/** Source order is acquisition order; arrival time never grants authority. */
export function financialObservationDisposition(
  next: FinancialRecordEvidence,
  prior: FinancialRecordEvidence,
  nextProvenance: FinancialWriteProvenance,
  priorProvenance: FinancialWriteProvenance
): 'advance' | 'replay' | 'stale' | 'conflict' {
  const verified = (p: FinancialWriteProvenance) =>
    p.source === 'connector' && !!p.credentialId && !!p.connectorId
  if (verified(priorProvenance) && !verified(nextProvenance)) return 'conflict'
  const x = position(next),
    y = position(prior)
  if (x[0] < y[0]) return 'stale'
  if (x[0] === y[0] && next.acquisition.id !== prior.acquisition.id) return 'conflict'
  if (next.acquisition.id === prior.acquisition.id) {
    if (x[0] !== y[0]) return 'conflict'
    if (x[1] < y[1]) return 'stale'
    if (x[1] === y[1])
      return accountingBasisHash(next) === accountingBasisHash(prior) ? 'replay' : 'conflict'
    if (
      'payout' in next &&
      'payout' in prior &&
      accountingBasisHash(next.payout) !== accountingBasisHash(prior.payout)
    )
      return 'conflict'
  }
  return 'advance'
}

/** Persist bounded records and their source observations in one organization-scoped transaction. */
export async function writeFinancialRecords(
  db: Db,
  input: {
    organizationId: string
    actorUserId: string
    records: FinancialRecordWrite[]
    provenance?: FinancialWriteProvenance
  }
): Promise<FinancialRecordWriteResult[]> {
  if (!input.records.length) return []
  if (input.records.length > 250)
    throw new UnprocessableEntityError('Financial record batches are limited to 250 source records')
  const parsed = input.records.map((record) => ({
    record,
    evidence: evidenceOf(record),
  }))
  const perform = async (tx: Transaction) => {
    await withAccountingCommitLock(tx, input.organizationId)
    const definitions = await tx
      .select()
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, input.organizationId),
          inArray(schema.EntityDefinition.entityType, ['payout', 'processor_balance_entry'])
        )
      )
    for (const item of parsed) {
      if (
        !definitions.some(
          (d) => d.id === item.record.entityDefinitionId && d.entityType === item.record.entityType
        )
      )
        throw new UnprocessableEntityError(
          'Financial record definition does not belong to this organization or resource type'
        )
    }
    if (parsed.length > 1000)
      throw new UnprocessableEntityError(
        'Financial pages exceed the 1000-record storage budget; submit smaller source batches'
      )
    const identities = [
      ...new Map(
        parsed.map(({ evidence }) => [accountKey(evidence.sourceAccount), evidence.sourceAccount])
      ).values(),
    ]
    const accounts = await tx
      .insert(schema.FinancialSourceAccount)
      .values(identities.map((a) => ({ organizationId: input.organizationId, ...a })))
      .onConflictDoUpdate({
        target: [
          schema.FinancialSourceAccount.organizationId,
          schema.FinancialSourceAccount.providerKey,
          schema.FinancialSourceAccount.externalAccountId,
          schema.FinancialSourceAccount.environment,
        ],
        set: { externalAccountId: sql`excluded."externalAccountId"` },
      })
      .returning()
    const accountsByKey = new Map(accounts.map((a) => [accountKey(a), a]))
    const objectInputs = [
      ...new Map(
        parsed.map((item) => {
          const account = accountsByKey.get(accountKey(item.evidence.sourceAccount))!
          const objectType = item.record.entityType === 'payout' ? 'payout' : 'balance_transaction'
          const external = externalId(item.evidence)
          return [
            objectKey(account.id, objectType, external),
            {
              organizationId: input.organizationId,
              sourceAccountId: account.id,
              objectType,
              externalId: external,
              componentKey: '',
            },
          ]
        })
      ).values(),
    ]
    const objects = await tx
      .insert(schema.FinancialSourceObject)
      .values(objectInputs)
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
    const objectsByKey = new Map(
      objects.map((o) => [objectKey(o.sourceAccountId, o.objectType, o.externalId), o])
    )
    const objectIds = objects.map((o) => o.id)
    const requestedIds = parsed.flatMap((p) => (p.record.recordId ? [p.record.recordId] : []))
    const [transfers, entries, latest] = await Promise.all([
      tx
        .select()
        .from(schema.MoneyTransfer)
        .where(
          and(
            eq(schema.MoneyTransfer.organizationId, input.organizationId),
            or(
              inArray(schema.MoneyTransfer.sourceObjectId, objectIds),
              requestedIds.length ? inArray(schema.MoneyTransfer.id, requestedIds) : undefined
            )
          )
        ),
      tx
        .select()
        .from(schema.ProcessorBalanceEntry)
        .where(
          and(
            eq(schema.ProcessorBalanceEntry.organizationId, input.organizationId),
            or(
              inArray(schema.ProcessorBalanceEntry.sourceObjectId, objectIds),
              requestedIds.length
                ? inArray(schema.ProcessorBalanceEntry.id, requestedIds)
                : undefined
            )
          )
        ),
      tx
        .selectDistinctOn([schema.FinancialSourceObservation.sourceObjectId])
        .from(schema.FinancialSourceObservation)
        .where(
          and(
            eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
            inArray(schema.FinancialSourceObservation.sourceObjectId, objectIds)
          )
        )
        .orderBy(
          schema.FinancialSourceObservation.sourceObjectId,
          sql`${schema.FinancialSourceObservation.observedAt} DESC`
        ),
    ])
    const canonicalByObject = new Map(
      [...transfers, ...entries].map((r) => [r.sourceObjectId, r.id])
    )
    for (const observation of latest) {
      const saved = observation.reportingInstallationSnapshot as { recordId?: string }
      if (saved.recordId && !canonicalByObject.has(observation.sourceObjectId))
        canonicalByObject.set(observation.sourceObjectId, saved.recordId)
    }
    const currentIds = [...transfers, ...entries].map((r) => r.currentObservationId)
    const current = currentIds.length
      ? await tx
          .select()
          .from(schema.FinancialSourceObservation)
          .where(
            and(
              eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
              inArray(schema.FinancialSourceObservation.id, currentIds)
            )
          )
      : []
    const latestByObject = new Map([...latest, ...current].map((o) => [o.sourceObjectId, o]))
    const batchCanonical = new Map<string, string>()
    const prepared = parsed.map((item) => {
      const account = accountsByKey.get(accountKey(item.evidence.sourceAccount))!
      const object = objectsByKey.get(
        objectKey(
          account.id,
          item.record.entityType === 'payout' ? 'payout' : 'balance_transaction',
          externalId(item.evidence)
        )
      )!
      const existing = canonicalByObject.get(object.id) ?? batchCanonical.get(object.id)
      if (existing && item.record.recordId && existing !== item.record.recordId)
        throw new FinancialSourceIdentityConflictError(existing)
      const assigned = item.record.recordId
        ? [...transfers, ...entries].find((r) => r.id === item.record.recordId)
        : undefined
      if (assigned && assigned.sourceObjectId !== object.id)
        throw new ConflictError('A canonical financial record cannot change its source identity')
      const id = existing ?? item.record.recordId ?? generateId()
      batchCanonical.set(object.id, id)
      const failure = normalizedFailure(item.evidence)
      if (
        failure &&
        input.provenance?.source !== 'connector' &&
        input.provenance?.source !== 'import'
      )
        throw new UnprocessableEntityError(failure)
      const contentHash = accountingBasisHash({
        evidence: item.evidence,
        provenance: input.provenance
          ? Object.fromEntries(
              Object.entries(input.provenance).filter(
                ([key, value]) => key !== 'ref' && value !== undefined
              )
            )
          : { source: 'manual' },
      })
      return { ...item, account, object, id, failure, contentHash }
    })
    const ids = [...new Set(prepared.map((p) => p.id))]
    const existingHeaders = await tx
      .select()
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, input.organizationId),
          inArray(schema.EntityInstance.id, ids)
        )
      )
    const headers = new Map(existingHeaders.map((r) => [r.id, r]))
    for (const p of prepared) {
      const header = headers.get(p.id)
      if (p.record.recordId && !header)
        throw new UnprocessableEntityError('Financial record does not exist in this organization')
      if (header && header.entityDefinitionId !== p.record.entityDefinitionId)
        throw new ConflictError('Financial source record belongs to another resource type')
    }
    const newHeaders = [
      ...new Map(
        prepared
          .filter((p) => !headers.has(p.id))
          .map((p) => [
            p.id,
            {
              id: p.id,
              organizationId: input.organizationId,
              entityDefinitionId: p.record.entityDefinitionId,
              displayName: p.object.externalId,
              createdById: input.actorUserId,
              updatedAt: new Date(),
            },
          ])
      ).values(),
    ]
    if (newHeaders.length)
      for (const row of await tx.insert(schema.EntityInstance).values(newHeaders).returning())
        headers.set(row.id, row)
    const payoutReferences = [
      ...new Set([
        ...prepared.flatMap((p) =>
          'entry' in p.evidence && p.evidence.entry?.payoutId ? [p.evidence.entry.payoutId] : []
        ),
        ...entries.flatMap((e) => (e.payoutExternalId ? [e.payoutExternalId] : [])),
      ]),
    ]
    const relatedTransfers = payoutReferences.length
      ? await tx
          .select({
            id: schema.MoneyTransfer.id,
            sourceAccountId: schema.MoneyTransfer.sourceAccountId,
            externalId: schema.MoneyTransfer.externalId,
          })
          .from(schema.MoneyTransfer)
          .where(
            and(
              eq(schema.MoneyTransfer.organizationId, input.organizationId),
              inArray(
                schema.MoneyTransfer.sourceAccountId,
                accounts.map((a) => a.id)
              ),
              inArray(schema.MoneyTransfer.externalId, payoutReferences)
            )
          )
      : []
    const affectedTransfers = (p: (typeof prepared)[number]) => {
      const old = entries.find((e) => e.id === p.id)?.payoutExternalId
      const next = 'entry' in p.evidence ? p.evidence.entry?.payoutId : p.evidence.payout?.id
      return [
        ...new Set([
          ...relatedTransfers
            .filter(
              (t) =>
                t.sourceAccountId === p.account.id &&
                (t.externalId === old || t.externalId === next)
            )
            .map((t) => t.id),
          ...prepared
            .filter(
              (other) =>
                other.record.entityType === 'payout' &&
                other.account.id === p.account.id &&
                other.object.externalId === next
            )
            .map((other) => other.id),
        ]),
      ]
    }
    const dispositions = new Map<
      (typeof prepared)[number],
      ReturnType<typeof financialObservationDisposition>
    >()
    const evaluated = new Map<string, { payload: unknown; reportingInstallationSnapshot: unknown }>(
      latestByObject
    )
    for (const p of prepared) {
      const prior = evaluated.get(p.object.id)
      const parsedPrior =
        p.record.entityType === 'payout'
          ? payoutRecordEvidenceSchema.safeParse(prior?.payload)
          : processorRecordEvidenceSchema.safeParse(prior?.payload)
      const disposition = parsedPrior.success
        ? financialObservationDisposition(
            p.evidence,
            parsedPrior.data,
            input.provenance ?? { source: 'manual' },
            prior!.reportingInstallationSnapshot as FinancialWriteProvenance
          )
        : 'advance'
      dispositions.set(p, disposition)
      if (disposition === 'advance' || disposition === 'replay')
        evaluated.set(p.object.id, {
          payload: p.evidence,
          reportingInstallationSnapshot: input.provenance ?? { source: 'manual' },
        })
      if (disposition === 'conflict')
        p.failure =
          p.failure ??
          'Source observation conflicts with the current acquisition or reporting authority'
    }
    const observationInputs = [
      ...new Map(
        prepared.map((p) => [
          `${p.object.id}:${p.contentHash}`,
          {
            organizationId: input.organizationId,
            sourceObjectId: p.object.id,
            contentHash: p.contentHash,
            observedAt: new Date(),
            payload: p.evidence,
            reportingInstallationSnapshot: {
              ...input.provenance,
              recordId: p.id,
              entityDefinitionId: p.record.entityDefinitionId,
              processorAccountId: p.account.id,
              affectedTransferIds: affectedTransfers(p),
              ...(p.failure ? { rejectionReason: p.failure } : {}),
            },
          },
        ])
      ).values(),
    ]
    const observations = await tx
      .insert(schema.FinancialSourceObservation)
      .values(observationInputs)
      .onConflictDoUpdate({
        target: [
          schema.FinancialSourceObservation.organizationId,
          schema.FinancialSourceObservation.sourceObjectId,
          schema.FinancialSourceObservation.contentHash,
        ],
        set: { contentHash: sql`excluded."contentHash"` },
      })
      .returning()
    const observationsByKey = new Map(
      observations.map((o) => [`${o.sourceObjectId}:${o.contentHash}`, o])
    )
    const transferWrites = new Map<string, typeof schema.MoneyTransfer.$inferInsert>()
    const entryWrites = new Map<string, typeof schema.ProcessorBalanceEntry.$inferInsert>()
    const result: FinancialRecordWriteResult[] = []
    for (const p of prepared) {
      const observation = observationsByKey.get(`${p.object.id}:${p.contentHash}`)!
      const prior = latestByObject.get(p.object.id)
      const disposition = dispositions.get(p)!
      const changed = disposition !== 'stale' && prior?.contentHash !== p.contentHash
      if (changed && !p.failure) latestByObject.set(p.object.id, observation)
      if (changed && !p.failure) {
        if ('payout' in p.evidence && p.evidence.payout) {
          const h = p.evidence.payout
          const amount = exactEvidenceMinor(h.amount, h.currency, h.currencyExponent)
          transferWrites.set(p.id, {
            id: p.id,
            organizationId: input.organizationId,
            sourceAccountId: p.account.id,
            sourceObjectId: p.object.id,
            currentObservationId: observation.id,
            externalId: h.id,
            status: h.status,
            sourceAmountMinor: amount,
            sourceCurrency: h.currency,
            sourceCurrencyExponent: h.currencyExponent,
            destinationAmountMinor: amount,
            destinationCurrency: h.currency,
            destinationCurrencyExponent: h.currencyExponent,
            datePrecision: h.issuedAt ? 'instant' : h.issuedOn ? 'date' : 'unknown',
            occurredAt: h.issuedAt ? new Date(h.issuedAt) : null,
            occurredOn: h.issuedOn,
            destinationExternalId: h.destinationExternalId,
            updatedAt: new Date(),
            reconciliationState: 'pending',
          })
        } else if ('entry' in p.evidence && p.evidence.entry) {
          const e = p.evidence.entry
          entryWrites.set(p.id, {
            id: p.id,
            organizationId: input.organizationId,
            sourceAccountId: p.account.id,
            sourceObjectId: p.object.id,
            currentObservationId: observation.id,
            externalId: e.id,
            type: e.type,
            grossMinor: exactEvidenceMinor(e.gross, e.currency, e.currencyExponent),
            feeMinor: exactEvidenceMinor(e.fee, e.currency, e.currencyExponent),
            netMinor: exactEvidenceMinor(e.net, e.currency, e.currencyExponent),
            currency: e.currency,
            currencyExponent: e.currencyExponent,
            transactionDate: e.transactionDate ? new Date(e.transactionDate) : null,
            payoutExternalId: e.payoutId,
            sourceTransactionId: e.sourceTransactionId,
            sourceOrderId: e.sourceOrderId,
            sourceId: e.sourceId,
            sourceType: e.sourceType,
            sourceReference: e.sourceReference ?? null,
            isOutgoingTransfer: e.type === 'outgoing_transfer',
          })
        }
      }
      result.push({
        id: p.id,
        entityDefinitionId: p.record.entityDefinitionId,
        entityType: p.record.entityType,
        instance: headers.get(p.id)!,
        created: newHeaders.some((h) => h.id === p.id),
        changed,
        disposition,
        observationId: observation.id,
        previousEvidence: prior?.payload ?? null,
        evidence: p.evidence,
      })
    }
    if (transferWrites.size)
      await tx
        .insert(schema.MoneyTransfer)
        .values([...transferWrites.values()])
        .onConflictDoUpdate({
          target: [schema.MoneyTransfer.organizationId, schema.MoneyTransfer.id],
          set: {
            currentObservationId: sql`excluded."currentObservationId"`,
            status: sql`excluded.status`,
            sourceAmountMinor: sql`excluded."sourceAmountMinor"`,
            sourceCurrency: sql`excluded."sourceCurrency"`,
            sourceCurrencyExponent: sql`excluded."sourceCurrencyExponent"`,
            destinationAmountMinor: sql`excluded."destinationAmountMinor"`,
            destinationCurrency: sql`excluded."destinationCurrency"`,
            destinationCurrencyExponent: sql`excluded."destinationCurrencyExponent"`,
            datePrecision: sql`excluded."datePrecision"`,
            occurredAt: sql`excluded."occurredAt"`,
            occurredOn: sql`excluded."occurredOn"`,
            destinationExternalId: sql`excluded."destinationExternalId"`,
            updatedAt: sql`excluded."updatedAt"`,
            reconciliationState: 'pending',
          },
        })
    if (entryWrites.size)
      await tx
        .insert(schema.ProcessorBalanceEntry)
        .values([...entryWrites.values()])
        .onConflictDoUpdate({
          target: [schema.ProcessorBalanceEntry.organizationId, schema.ProcessorBalanceEntry.id],
          set: {
            currentObservationId: sql`excluded."currentObservationId"`,
            type: sql`excluded.type`,
            grossMinor: sql`excluded."grossMinor"`,
            feeMinor: sql`excluded."feeMinor"`,
            netMinor: sql`excluded."netMinor"`,
            currency: sql`excluded.currency`,
            currencyExponent: sql`excluded."currencyExponent"`,
            transactionDate: sql`excluded."transactionDate"`,
            payoutExternalId: sql`excluded."payoutExternalId"`,
            sourceTransactionId: sql`excluded."sourceTransactionId"`,
            sourceOrderId: sql`excluded."sourceOrderId"`,
            sourceId: sql`excluded."sourceId"`,
            sourceType: sql`excluded."sourceType"`,
            sourceReference: sql`excluded."sourceReference"`,
            isOutgoingTransfer: sql`excluded."isOutgoingTransfer"`,
          },
        })
    const rejectedAdvances = prepared.filter(
      (p) =>
        p.record.entityType === 'payout' &&
        p.failure &&
        dispositions.get(p) === 'advance' &&
        transfers.some((t) => t.id === p.id)
    )
    if (rejectedAdvances.length) {
      const pairs = rejectedAdvances.map(
        (p) => sql`(${p.id}, ${observationsByKey.get(`${p.object.id}:${p.contentHash}`)!.id})`
      )
      await tx.execute(
        sql`UPDATE ${schema.MoneyTransfer} AS transfer SET "currentObservationId" = rejected.observation_id, "reconciliationState" = 'pending', "updatedAt" = now() FROM (VALUES ${sql.join(pairs, sql`,`)}) AS rejected(record_id, observation_id) WHERE transfer."organizationId" = ${input.organizationId} AND transfer.id = rejected.record_id`
      )
    }
    const rejectedTransferIds = prepared
      .filter(
        (p) => p.record.entityType === 'payout' && p.failure && dispositions.get(p) !== 'stale'
      )
      .map((p) => p.id)
    if (rejectedTransferIds.length)
      await tx
        .update(schema.MoneyTransfer)
        .set({ reconciliationState: 'pending' })
        .where(
          and(
            eq(schema.MoneyTransfer.organizationId, input.organizationId),
            inArray(schema.MoneyTransfer.id, rejectedTransferIds)
          )
        )
    const changedEntryIds = new Set(entryWrites.keys())
    const affectedPayouts = [
      ...new Set(
        [
          ...entries.filter((e) => changedEntryIds.has(e.id)).map((e) => e.payoutExternalId),
          ...[...entryWrites.values()].map((e) => e.payoutExternalId),
        ].filter((x): x is string => !!x)
      ),
    ]
    if (affectedPayouts.length)
      await tx
        .update(schema.MoneyTransfer)
        .set({ reconciliationState: 'pending' })
        .where(
          and(
            eq(schema.MoneyTransfer.organizationId, input.organizationId),
            inArray(
              schema.MoneyTransfer.sourceAccountId,
              accounts.map((a) => a.id)
            ),
            inArray(schema.MoneyTransfer.externalId, affectedPayouts)
          )
        )
    const changedIds = [...new Set(result.filter((r) => r.changed).map((r) => r.id))]
    if (changedIds.length)
      await tx
        .update(schema.EntityInstance)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(schema.EntityInstance.organizationId, input.organizationId),
            inArray(schema.EntityInstance.id, changedIds)
          )
        )
    await persistMembershipCoverage(
      tx,
      input.organizationId,
      prepared
        .filter((p) => 'payout' in p.evidence)
        .map((p) => ({
          sourceAccountId: p.account.id,
          evidence: p.evidence as PayoutRecordEvidence,
          observationId: observationsByKey.get(`${p.object.id}:${p.contentHash}`)!.id,
          conflict: dispositions.get(p) === 'conflict',
        }))
    )
    return result
  }
  return db instanceof PgTransaction ? perform(db as Transaction) : db.transaction(perform)
}

type SavedPage = {
  id: string
  index: number
  pageId: string
  evidenceHash: string
  requestCursor: string | null
  nextCursor: string | null
  terminal: boolean
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
}
async function persistMembershipCoverage(
  tx: Transaction,
  organizationId: string,
  inputs: Array<{
    sourceAccountId: string
    evidence: PayoutRecordEvidence
    observationId: string
    conflict: boolean
  }>
) {
  if (!inputs.length) return
  const windowOf = (e: PayoutRecordEvidence) =>
    `payout:${externalId(e)}:acquisition:${e.acquisition.id}`
  const keyOf = (accountId: string, windowKey: string) => JSON.stringify([accountId, windowKey])
  const existing = await tx
    .select()
    .from(schema.FinancialSourceCoverage)
    .where(
      and(
        eq(schema.FinancialSourceCoverage.organizationId, organizationId),
        inArray(schema.FinancialSourceCoverage.sourceAccountId, [
          ...new Set(inputs.map((i) => i.sourceAccountId)),
        ]),
        eq(schema.FinancialSourceCoverage.streamKey, 'payout_membership'),
        inArray(schema.FinancialSourceCoverage.windowKey, [
          ...new Set(inputs.map((i) => windowOf(i.evidence))),
        ])
      )
    )
  const pending = new Map<string, typeof schema.FinancialSourceCoverage.$inferInsert>(
    existing.map((r) => [keyOf(r.sourceAccountId, r.windowKey), r])
  )
  const touched = new Set<string>()
  for (const input of inputs) {
    const e = input.evidence
    const windowKey = windowOf(e)
    const key = keyOf(input.sourceAccountId, windowKey)
    const prior = pending.get(key)
    const saved = (prior?.fetchedBoundary ?? {}) as {
      pageObservations?: SavedPage[]
      headerObservationId?: string
      conflict?: boolean
    }
    const pages = new Map((saved.pageObservations ?? []).map((p) => [p.pageId, p]))
    const page = e.membership.page
    const samePage = page ? pages.get(page.id) : undefined
    const evidenceHash = accountingBasisHash(e)
    const conflict =
      input.conflict || !!saved.conflict || (!!samePage && samePage.evidenceHash !== evidenceHash)
    if (page && !conflict)
      pages.set(page.id, {
        id: input.observationId,
        index: page.index,
        pageId: page.id,
        evidenceHash,
        requestCursor: page.requestCursor,
        nextCursor: page.nextCursor,
        terminal: page.terminal,
        fetchedCount: e.membership.entries.length + e.membership.rejections.length,
        acceptedCount: e.membership.entries.length,
        rejectedCount: e.membership.rejections.length,
      })
    const chain = [...pages.values()].sort((a, b) => a.index - b.index)
    const terminal = chain.at(-1)
    const complete =
      !!terminal?.terminal &&
      chain.every(
        (p, i) =>
          p.index === i &&
          (i === 0 ? p.requestCursor === null : p.requestCursor === chain[i - 1]!.nextCursor) &&
          p.rejectedCount === 0
      ) &&
      !e.rejectionReason &&
      !conflict
    const counts = chain.reduce(
      (a, p) => ({
        fetchedCount: a.fetchedCount + p.fetchedCount,
        acceptedCount: a.acceptedCount + p.acceptedCount,
        rejectedCount: a.rejectedCount + p.rejectedCount,
      }),
      { fetchedCount: 0, acceptedCount: 0, rejectedCount: 0 }
    )
    const values = {
      organizationId,
      sourceAccountId: input.sourceAccountId,
      streamKey: 'payout_membership',
      windowKey,
      requestedBoundary: {
        externalId: externalId(e),
        acquisitionId: e.acquisition.id,
        startedAt: e.acquisition.startedAt,
      },
      fetchedBoundary: {
        acquisitionId: e.acquisition.id,
        headerObservationId: saved.headerObservationId ?? input.observationId,
        pageObservations: chain,
        providerReady: e.membership.providerReady,
        reason: conflict
          ? 'Conflicting source evidence for the same acquisition'
          : e.membership.reason,
        conflict,
      },
      ...counts,
      pendingCount: 0,
      complete,
      updatedAt: new Date(),
    }
    pending.set(key, values)
    touched.add(key)
  }
  await tx
    .insert(schema.FinancialSourceCoverage)
    .values([...touched].map((key) => pending.get(key)!))
    .onConflictDoUpdate({
      target: [
        schema.FinancialSourceCoverage.organizationId,
        schema.FinancialSourceCoverage.sourceAccountId,
        schema.FinancialSourceCoverage.streamKey,
        schema.FinancialSourceCoverage.windowKey,
      ],
      set: {
        fetchedBoundary: sql`excluded."fetchedBoundary"`,
        fetchedCount: sql`excluded."fetchedCount"`,
        acceptedCount: sql`excluded."acceptedCount"`,
        rejectedCount: sql`excluded."rejectedCount"`,
        pendingCount: sql`excluded."pendingCount"`,
        complete: sql`excluded.complete`,
        updatedAt: sql`excluded."updatedAt"`,
      },
    })
}
