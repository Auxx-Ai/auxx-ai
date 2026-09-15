// packages/lib/src/money/customer-money/adopt-native-stripe.ts
import { type Database, schema, withAccountingCommitLock } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { accountingBasisHash } from '../../postings/effect-basis'
import { getStripeConnectClient } from '../payments/connect-client'

/** Recorded verification associates existing native Stripe evidence with one observed Shopify movement. */
export interface AdoptNativeStripeMoneyInput {
  organizationId: string
  legacyTransactionId: string
  shopifySourceObjectId: string
  commandKey: string
  actorUserId: string
  evidence: string
}

/** Reuse a Shopify canonical movement for an evidenced native Stripe receipt/refund without posting again. */
export async function adoptNativeStripeMoney(
  db: Database,
  input: AdoptNativeStripeMoneyInput
): Promise<{ moneyTransactionId: string }> {
  if (!input.actorUserId || !input.commandKey || !input.evidence.trim())
    throw new UnprocessableEntityError('Explicit source identity verification is required')
  const retryHash = accountingBasisHash({
    legacyTransactionId: input.legacyTransactionId,
    shopifySourceObjectId: input.shopifySourceObjectId,
    evidence: input.evidence,
  })
  const saved = await db.query.MoneyCommand.findFirst({
    where: and(
      eq(schema.MoneyCommand.organizationId, input.organizationId),
      eq(schema.MoneyCommand.commandKey, input.commandKey)
    ),
  })
  if (saved) {
    if (saved.payloadHash !== retryHash) throw new ConflictError('Verification command changed')
    return saved.resultIds as { moneyTransactionId: string }
  }
  const nativeSnapshot = await db.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.organizationId, input.organizationId),
      eq(schema.PaymentTransaction.id, input.legacyTransactionId)
    ),
  })
  const accountSnapshot = nativeSnapshot?.paymentAccountId
    ? await db.query.PaymentAccount.findFirst({
        where: and(
          eq(schema.PaymentAccount.organizationId, input.organizationId),
          eq(schema.PaymentAccount.id, nativeSnapshot.paymentAccountId)
        ),
      })
    : undefined
  const remoteId =
    nativeSnapshot?.kind === 'refund'
      ? nativeSnapshot.stripeRefundId
      : nativeSnapshot?.stripeChargeId
  if (
    !nativeSnapshot ||
    nativeSnapshot.provider !== 'stripe' ||
    !accountSnapshot?.stripeAccountId ||
    !remoteId
  )
    throw new UnprocessableEntityError(
      'Native Stripe merchant and individual movement evidence is missing'
    )
  const stripe = getStripeConnectClient()
  const remote =
    nativeSnapshot.kind === 'refund'
      ? await stripe.refunds.retrieve(remoteId, { stripeAccount: accountSnapshot.stripeAccountId })
      : await stripe.charges.retrieve(remoteId, { stripeAccount: accountSnapshot.stripeAccountId })
  const environmentCharge =
    remote.object === 'charge'
      ? remote
      : typeof remote.charge === 'string'
        ? await stripe.charges.retrieve(remote.charge, {
            stripeAccount: accountSnapshot.stripeAccountId,
          })
        : remote.charge
  if (!environmentCharge)
    throw new UnprocessableEntityError(
      'Stripe refund parent charge is required to verify environment'
    )
  const livemode = environmentCharge.livemode
  const confirmed =
    remote.object === 'refund'
      ? remote.status === 'succeeded'
      : remote.paid && remote.captured && remote.status === 'succeeded'
  const remoteAmount = remote.object === 'refund' ? remote.amount : remote.amount_captured
  if (
    !confirmed ||
    remote.id !== remoteId ||
    remoteAmount !== nativeSnapshot.amount ||
    remote.currency.toUpperCase() !== nativeSnapshot.currency.toUpperCase()
  )
    throw new ConflictError('Stripe readback does not match the confirmed native movement')
  return db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, input.organizationId)
    const payloadHash = accountingBasisHash({
      legacyTransactionId: input.legacyTransactionId,
      shopifySourceObjectId: input.shopifySourceObjectId,
      evidence: input.evidence,
    })
    const previous = await tx.query.MoneyCommand.findFirst({
      where: and(
        eq(schema.MoneyCommand.organizationId, input.organizationId),
        eq(schema.MoneyCommand.commandKey, input.commandKey)
      ),
    })
    if (previous) {
      if (previous.payloadHash !== payloadHash)
        throw new ConflictError('Verification command changed')
      const result = previous.resultIds as { moneyTransactionId: string }
      return result
    }
    const native = await tx.query.PaymentTransaction.findFirst({
      where: and(
        eq(schema.PaymentTransaction.organizationId, input.organizationId),
        eq(schema.PaymentTransaction.id, input.legacyTransactionId)
      ),
    })
    if (
      !native ||
      native.provider !== 'stripe' ||
      !['succeeded', 'refunded', 'disputed'].includes(native.status) ||
      !native.paymentAccountId
    )
      throw new UnprocessableEntityError('Native Stripe movement is not confirmed')
    const account = await tx.query.PaymentAccount.findFirst({
      where: and(
        eq(schema.PaymentAccount.organizationId, input.organizationId),
        eq(schema.PaymentAccount.id, native.paymentAccountId)
      ),
    })
    const externalId = native.kind === 'refund' ? native.stripeRefundId : native.stripeChargeId
    if (
      account?.stripeAccountId !== accountSnapshot.stripeAccountId ||
      externalId !== remote.id ||
      native.amount !== remoteAmount ||
      native.currency.toUpperCase() !== remote.currency.toUpperCase()
    )
      throw new ConflictError('Native Stripe evidence changed during verification')
    if (!account?.stripeAccountId || !externalId)
      throw new UnprocessableEntityError(
        'Native Stripe merchant or individual capture/refund identity is missing'
      )
    const source = await tx.query.FinancialSourceObject.findFirst({
      where: and(
        eq(schema.FinancialSourceObject.organizationId, input.organizationId),
        eq(schema.FinancialSourceObject.id, input.shopifySourceObjectId)
      ),
    })
    const sourceAccount = source
      ? await tx.query.FinancialSourceAccount.findFirst({
          where: and(
            eq(schema.FinancialSourceAccount.organizationId, input.organizationId),
            eq(schema.FinancialSourceAccount.id, source.sourceAccountId)
          ),
        })
      : undefined
    const link = source
      ? await tx.query.MoneySourceLink.findFirst({
          where: and(
            eq(schema.MoneySourceLink.organizationId, input.organizationId),
            eq(schema.MoneySourceLink.sourceObjectId, source.id)
          ),
        })
      : undefined
    const money = link
      ? await tx.query.MoneyTransaction.findFirst({
          where: and(
            eq(schema.MoneyTransaction.organizationId, input.organizationId),
            eq(schema.MoneyTransaction.id, link.moneyTransactionId)
          ),
        })
      : undefined
    if (sourceAccount && sourceAccount.environment !== (livemode ? 'live' : 'test'))
      throw new ConflictError('Stripe and Shopify environments do not match')
    if (!money || sourceAccount?.providerKey !== 'shopify')
      throw new UnprocessableEntityError(
        'Shopify source must first contain a confirmed canonical movement'
      )
    if (
      money.amountMinor !== BigInt(native.amount) ||
      money.currency !== native.currency.toUpperCase() ||
      money.purpose !== (native.kind === 'refund' ? 'customer_refund' : 'customer_receipt') ||
      (native.contactInstanceId &&
        money.partyInstanceId &&
        native.contactInstanceId !== money.partyInstanceId)
    )
      throw new ConflictError('The native and observed movement basis does not match')
    const [stripeAccount] = await tx
      .insert(schema.FinancialSourceAccount)
      .values({
        organizationId: input.organizationId,
        providerKey: 'stripe',
        externalAccountId: account.stripeAccountId,
        environment: sourceAccount.environment,
      })
      .onConflictDoUpdate({
        target: [
          schema.FinancialSourceAccount.organizationId,
          schema.FinancialSourceAccount.providerKey,
          schema.FinancialSourceAccount.externalAccountId,
          schema.FinancialSourceAccount.environment,
        ],
        set: { externalAccountId: account.stripeAccountId },
      })
      .returning()
    const [stripeObject] = await tx
      .insert(schema.FinancialSourceObject)
      .values({
        organizationId: input.organizationId,
        sourceAccountId: stripeAccount!.id,
        objectType: native.kind === 'refund' ? 'refund' : 'charge',
        externalId,
        componentKey: '',
      })
      .onConflictDoUpdate({
        target: [
          schema.FinancialSourceObject.organizationId,
          schema.FinancialSourceObject.sourceAccountId,
          schema.FinancialSourceObject.objectType,
          schema.FinancialSourceObject.externalId,
          schema.FinancialSourceObject.componentKey,
        ],
        set: { externalId },
      })
      .returning()
    const stripeLink = await tx.query.MoneySourceLink.findFirst({
      where: and(
        eq(schema.MoneySourceLink.organizationId, input.organizationId),
        eq(schema.MoneySourceLink.sourceObjectId, stripeObject!.id)
      ),
    })
    if (stripeLink && stripeLink.moneyTransactionId !== money.id)
      throw new ConflictError(
        'Stripe evidence already belongs to a different canonical movement; explicit duplicate correction required'
      )
    const [command] = await tx
      .insert(schema.MoneyCommand)
      .values({
        organizationId: input.organizationId,
        commandKey: input.commandKey,
        kind: 'adopt_native_stripe_evidence',
        payloadHash,
        actorSnapshot: { userId: input.actorUserId, evidence: input.evidence },
        resultIds: { moneyTransactionId: money.id },
      })
      .returning()
    const payload = {
      legacyTransactionId: native.id,
      provider: 'stripe',
      merchantAccountId: account.stripeAccountId,
      externalId,
      purpose: money.purpose,
      amountMinor: money.amountMinor.toString(),
      currency: money.currency,
      evidence: input.evidence,
    }
    await tx
      .insert(schema.FinancialSourceObservation)
      .values({
        organizationId: input.organizationId,
        sourceObjectId: stripeObject!.id,
        contentHash: accountingBasisHash(payload),
        observedAt: new Date(),
        payload,
        reportingInstallationSnapshot: { kind: 'native_stripe', paymentAccountId: account.id },
      })
      .onConflictDoNothing()
    await tx
      .insert(schema.MoneySourceLink)
      .values({
        organizationId: input.organizationId,
        sourceObjectId: stripeObject!.id,
        moneyTransactionId: money.id,
        verifiedByCommandId: command!.id,
      })
      .onConflictDoNothing({
        target: [schema.MoneySourceLink.organizationId, schema.MoneySourceLink.sourceObjectId],
      })
    await tx.insert(schema.AuditLog).values({
      organizationId: input.organizationId,
      category: 'settings',
      action: 'setting.changed',
      targetType: 'MoneyTransaction',
      targetId: money.id,
      actorType: 'user',
      actorId: input.actorUserId,
      newState: {
        legacyTransactionId: native.id,
        sourceObjectId: stripeObject!.id,
        evidence: input.evidence,
      },
    })
    return { moneyTransactionId: money.id }
  })
}
