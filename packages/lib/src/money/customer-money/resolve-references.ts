// packages/lib/src/money/customer-money/resolve-references.ts
import { type Database, schema, withAccountingCommitLock } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { accountingBasisHash } from '../../postings/effect-basis'
import { confirmedCustomerMovement } from './contracts'
import { readStoredCustomerMoneyObservation } from './source-observation-adapter'

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
    const previous = await tx.query.MoneyCommand.findFirst({
      where: and(
        eq(schema.MoneyCommand.organizationId, input.organizationId),
        eq(schema.MoneyCommand.commandKey, input.commandKey)
      ),
    })
    if (previous) {
      if (previous.payloadHash !== hash)
        throw new ConflictError('Resolution command was reused with different evidence')
      return
    }
    const money = await tx.query.MoneyTransaction.findFirst({
      where: and(
        eq(schema.MoneyTransaction.organizationId, input.organizationId),
        eq(schema.MoneyTransaction.id, input.moneyTransactionId)
      ),
    })
    if (!money) throw new UnprocessableEntityError('Money transaction is not in this organization')
    for (const objectId of objectIds) {
      const object = await tx.query.FinancialSourceObject.findFirst({
        where: and(
          eq(schema.FinancialSourceObject.organizationId, input.organizationId),
          eq(schema.FinancialSourceObject.id, objectId)
        ),
      })
      if (!object)
        throw new UnprocessableEntityError('Verified source object is not in this organization')
      const sourceAccount = await tx.query.FinancialSourceAccount.findFirst({
        where: and(
          eq(schema.FinancialSourceAccount.organizationId, input.organizationId),
          eq(schema.FinancialSourceAccount.id, object.sourceAccountId)
        ),
      })
      if (sourceAccount?.environment !== 'live')
        throw new UnprocessableEntityError('Test source evidence cannot bind operational money')
      const link = await tx.query.MoneySourceLink.findFirst({
        where: and(
          eq(schema.MoneySourceLink.organizationId, input.organizationId),
          eq(schema.MoneySourceLink.sourceObjectId, objectId)
        ),
      })
      if (link && link.moneyTransactionId !== money.id)
        throw new ConflictError(
          'Both source objects already materialized; duplicate resolution requires an explicit correction'
        )
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
        kind: 'resolve_money_references',
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
    if (objectIds.length)
      await tx
        .update(schema.FinancialSourceAcceptance)
        .set({
          moneyTransactionId: money.id,
          state: 'pending',
          nextAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
            inArray(schema.FinancialSourceAcceptance.sourceObjectId, objectIds)
          )
        )
    await tx.insert(schema.AuditLog).values({
      organizationId: input.organizationId,
      category: 'settings',
      action: 'setting.changed',
      targetType: 'MoneyTransaction',
      targetId: money.id,
      actorType: 'user',
      actorId: input.actorUserId,
      previousState: {},
      newState: { sourceObjectIds: objectIds, evidence: input.evidence },
    })
  })
}
