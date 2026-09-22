// packages/lib/src/accounting/money/customer-money/resolve-references.ts
import { type Database, schema, withAccountingCommitLock } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { recordAudit } from '../../../audit-log'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { readLiveSourceAccountIds } from '../../ledger/roles/source-scope'
import { wakeSources } from '../../work-items/wake'
import { findMoneyCommandByKey } from '../commands/run-money-command'
import { findSourceLink, readMovement } from '../reads'
import { confirmedCustomerMovement } from './contracts'
import { readStoredCustomerMoneyObservation } from './source-observation-adapter'
import { readSourceObject } from './source-reads'
import { updateAcceptancesBySourceObjects } from './source-writes'

const RESOLVE_COMMAND_KIND = 'resolve_money_references'

/** Explicit verified source association; similarity is never evidence. */
export interface ResolveImportedMoneyReferencesInput {
  organizationId: string
  moneyTransactionId: string
  sourceObjectIds: string[]
  commandKey: string
  actorUserId: string
  evidence: string
}

/** Link evidenced provider objects to one immutable movement. */
export async function resolveImportedMoneyReferences(
  db: Database,
  input: ResolveImportedMoneyReferencesInput
): Promise<void> {
  if (
    !input.commandKey ||
    !input.actorUserId ||
    !input.evidence.trim() ||
    input.sourceObjectIds.length > 100
  )
    throw new UnprocessableEntityError('Verified source evidence and command identity are required')
  const objectIds = [...new Set(input.sourceObjectIds)].sort()
  const hash = accountingBasisHash({
    moneyTransactionId: input.moneyTransactionId,
    sourceObjectIds: objectIds,
    evidence: input.evidence,
  })
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, input.organizationId)
    const previous = await findMoneyCommandByKey(tx, input.organizationId, input.commandKey, {
      kind: RESOLVE_COMMAND_KIND,
      payloadHash: hash,
    })
    if (previous) return
    const money = await readMovement(tx, input.organizationId, input.moneyTransactionId)
    if (!money) throw new UnprocessableEntityError('Money transaction is not in this organization')
    for (const objectId of objectIds) {
      const object = await readSourceObject(tx, input.organizationId, objectId)
      if (!object)
        throw new UnprocessableEntityError('Verified source object is not in this organization')
      const live = await readLiveSourceAccountIds(tx, input.organizationId, [
        object.sourceAccountId,
      ])
      if (!live.has(object.sourceAccountId))
        throw new UnprocessableEntityError('Test source evidence cannot bind operational money')
      const link = await findSourceLink(tx, input.organizationId, objectId)
      if (link && link.moneyTransactionId !== money.id)
        throw new ConflictError(
          'Both source objects already materialized; duplicate resolution requires an explicit correction'
        )
      // Every observation this object ever carried has to agree with the
      // movement, not just the current one: an older disagreeing reading is
      // what this command exists to refuse.
      const observations = await tx.query.FinancialSourceObservation.findMany({
        where: and(
          eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
          eq(schema.FinancialSourceObservation.sourceObjectId, objectId)
        ),
      })
      let matched = false
      for (const observation of observations) {
        const parsed = readStoredCustomerMoneyObservation(observation.payload)
        if (!parsed.success) continue
        if (parsed.data.test)
          throw new UnprocessableEntityError('Test source evidence cannot bind operational money')
        let fact: ReturnType<typeof confirmedCustomerMovement>
        try {
          fact = confirmedCustomerMovement(parsed.data)
        } catch {
          continue
        }
        matched = true
        if (
          fact.amountMinor !== money.amountMinor ||
          fact.currency !== money.currency ||
          fact.purpose !== money.purpose
        )
          throw new ConflictError(
            'Verified source amount, currency or purpose does not match the movement'
          )
      }
      if (!matched)
        throw new UnprocessableEntityError(
          'Source object has no confirmed amount and currency evidence'
        )
    }
    const [command] = await tx
      .insert(schema.MoneyCommand)
      .values({
        organizationId: input.organizationId,
        commandKey: input.commandKey,
        kind: RESOLVE_COMMAND_KIND,
        payloadHash: hash,
        actorSnapshot: { userId: input.actorUserId, evidence: input.evidence },
        resultIds: { moneyTransactionId: money.id },
      })
      .returning()
    for (const objectId of objectIds)
      await tx
        .insert(schema.MoneySourceLink)
        .values({
          organizationId: input.organizationId,
          sourceObjectId: objectId,
          moneyTransactionId: money.id,
          verifiedByCommandId: command!.id,
        })
        .onConflictDoNothing({
          target: [schema.MoneySourceLink.organizationId, schema.MoneySourceLink.sourceObjectId],
        })
    await updateAcceptancesBySourceObjects(tx, input.organizationId, objectIds, {
      moneyTransactionId: money.id,
      state: 'pending',
    })
    // A person resolved them: due now.
    const resolved = await tx
      .select({ id: schema.FinancialSourceAcceptance.id })
      .from(schema.FinancialSourceAcceptance)
      .where(
        and(
          eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
          inArray(schema.FinancialSourceAcceptance.sourceObjectId, objectIds)
        )
      )
    await wakeSources(tx, input.organizationId, {
      sourceKind: 'financial_source_acceptance',
      sourceIds: resolved.map((row) => row.id),
      stage: 'evidence',
    })
    await recordAudit(
      {
        organizationId: input.organizationId,
        category: 'settings',
        action: 'setting.changed',
        targetType: 'MoneyTransaction',
        targetId: money.id,
        actorType: 'user',
        actorId: input.actorUserId,
        previousState: {},
        newState: { sourceObjectIds: objectIds, evidence: input.evidence },
      },
      tx
    )
  })
}
