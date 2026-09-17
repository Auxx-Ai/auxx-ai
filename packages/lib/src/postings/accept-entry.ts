// packages/lib/src/postings/accept-entry.ts
import { type AccountingWorkEntity, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../errors'
import { withAccountingCommitLock } from './accounting-commit-lock'
import {
  type AcceptedMoneyApplicationEffectBasisV1,
  acceptedMoneyApplicationEffectBasisSchema,
  MONEY_APPLICATION_POSTING_TYPE,
  MONEY_APPLICATION_RESOURCE_KIND,
} from './application-effect-types'
import { acceptedCustomerCreditEffectBasisSchema } from './credit-effect-types'
import { documentGenerationKey, fulfillmentGroupPeriodKey } from './doc-number'
import {
  type AcceptedDocumentEffectBasisV1,
  acceptedDocumentEffectBasisSchema,
  DOCUMENT_EFFECT_FAMILY_SPEC,
  type DocumentEffectFamily,
  documentRoleScope,
  isDocumentEffectFamily,
} from './document-effect-types'
import { type PostingAccountingMembership, parsePostingAccountingMembership } from './draft'
import { accountingBasisHash, canonicalAccountingJson } from './effect-basis'
import {
  type AcceptedAccountingEffectBasisV1,
  type AcceptedCustomerReceiptEffectBasisV1,
  type AcceptedFulfillmentEffectBasisV1,
  type AccountingWorkBasisInputV1,
  acceptedCustomerReceiptEffectBasisSchema,
  acceptedFulfillmentEffectBasisSchema,
  accountingWorkBasisSchemaV1,
} from './effect-types'
import { insertPostingInTx, type PostingDeliveryIntent, type PreparedLine } from './insert-posting'
import { resolvePeriodLock } from './period-lock'
import { prepareEntry, uniqueViolationConstraint } from './post-entry'
import { acceptedCustomerRefundEffectBasisSchema } from './refund-effect-types'
import { type RoleSourceScope, resolveRoles } from './resolve-roles'
import type { BuiltEntry } from './types'

type ReadyBasis = Extract<AccountingWorkBasisInputV1, { status: 'ready' }>

/** The `GlPostingType`s D19's document families claim. */
const DOCUMENT_EFFECT_POSTING_TYPES: ReadonlySet<string> = new Set(
  Object.values(DOCUMENT_EFFECT_FAMILY_SPEC).map((spec) => spec.postingType)
)

/** A prepared domain member; identity comes from its persisted work, never grouping metadata. */
export interface PreparedEffectMember<
  TBasis extends AcceptedAccountingEffectBasisV1 = AcceptedFulfillmentEffectBasisV1,
> {
  workId: string
  expectedBasisVersion: number
  acceptedBasis: TBasis
  /** Required for corrections; null means there have been no accepted corrections. */
  expectedCorrectionHeadId?: string | null
}

/** Commit input supplied only by a trusted financial-domain command. */
export interface PreparedEffectPosting {
  organizationId: string
  actorUserId?: string
  memo?: string
  members: PreparedEffectMember<AcceptedAccountingEffectBasisV1>[]
  entry: BuiltEntry
  deliveryIntent: PostingDeliveryIntent
}

/** Each domain re-reads its source and configuration dependencies using this transaction. */
export interface EffectAcceptanceDependencies {
  revalidateMemberInTx(
    tx: Transaction,
    work: AccountingWorkEntity,
    basis: ReadyBasis
  ): Promise<AcceptedAccountingEffectBasisV1>
}

/**
 * Both receipt policies, as `isFulfillmentBasis` below already does for its
 * two: one `customer_receipt` family, one contract, two frozen calculation
 * shapes (task 54 §7). Missing the second here does not fail loudly — it makes
 * every invoice receipt look like an owner mismatch.
 */
function isReceiptBasis(
  basis: AcceptedAccountingEffectBasisV1
): basis is AcceptedCustomerReceiptEffectBasisV1 {
  return basis.policyKey === 'shopify_receipt_v1' || basis.policyKey === 'invoice_receipt_v1'
}

function isFulfillmentBasis(
  basis: AcceptedAccountingEffectBasisV1
): basis is AcceptedFulfillmentEffectBasisV1 {
  return (
    basis.policyKey === 'fulfillment_current_v1' || basis.policyKey === 'shopify_payment_date_v1'
  )
}

function parseAcceptedBasis(
  effectKind: AccountingWorkEntity['effectKind'],
  basis: unknown
): AcceptedAccountingEffectBasisV1 {
  switch (effectKind) {
    case 'customer_receipt':
      return acceptedCustomerReceiptEffectBasisSchema.parse(basis)
    case 'customer_credit_issued':
      return acceptedCustomerCreditEffectBasisSchema.parse(basis)
    case 'customer_refund':
      return acceptedCustomerRefundEffectBasisSchema.parse(basis)
    case 'fulfillment_accounting':
      return acceptedFulfillmentEffectBasisSchema.parse(basis)
    // D19's document-driven families all share one contract; the family is a
    // field ON the calculation, re-checked against the work below.
    case 'invoice_issued':
    case 'invoice_write_off':
    case 'payout_settlement':
    case 'expense_bill':
    case 'vendor_bill_matched':
    case 'inventory_receipt':
      return acceptedDocumentEffectBasisSchema.parse(basis)
    // Money-owned, and its own contract: the movement is the owner and the
    // invoice is a reference. See `application-effect-types.ts`.
    case 'deposit_application':
      return acceptedMoneyApplicationEffectBasisSchema.parse(basis)
  }
}

function isMoneyApplicationBasis(
  basis: AcceptedAccountingEffectBasisV1
): basis is AcceptedMoneyApplicationEffectBasisV1 {
  return basis.policyKey === 'money_application_v1'
}

function isDocumentBasis(
  basis: AcceptedAccountingEffectBasisV1
): basis is AcceptedDocumentEffectBasisV1 {
  return basis.policyKey === 'document_entry_v1'
}

/**
 * The `EntityInstance.entityType` an entity-owned work must still resolve to.
 *
 * Read at acceptance rather than trusted from preparation: an archived or
 * retyped source between preparing and accepting is exactly the drift this
 * guard exists to catch.
 */
function ownerEntityType(effectKind: AccountingWorkEntity['effectKind']): string {
  if (isDocumentEffectFamily(effectKind)) return DOCUMENT_EFFECT_FAMILY_SPEC[effectKind].entityType
  return effectKind === 'customer_credit_issued' ? 'credit_memo' : 'fulfillment'
}

/** Saved acceptance can span more than one journal after a caller regroups existing members. */
export interface AcceptedPostingResult {
  status: 'accepted'
  existing: boolean
  glPostingIds: string[]
  glPostingId?: string
  effectIds: string[]
  postings: Array<{ glPostingId: string; deliveryIntent: PostingDeliveryIntent }>
  deliveryIntent?: PostingDeliveryIntent
}

/** The caller must rebuild totals from precisely these remaining members before trying again. */
export interface PostingReplanResult {
  status: 'replan'
  acceptedWorkIds: string[]
  remainingWorkIds: string[]
}

function readMembership(draft: unknown): PostingAccountingMembership {
  if (draft === null || typeof draft !== 'object' || !('accountingMembership' in draft))
    throw new ConflictError('The existing journal has no provable accounting membership')
  return parsePostingAccountingMembership(draft.accountingMembership)
}

function contributionKey(line: {
  glAccountId: string
  direction: string
  counterpartyType?: string | null
  counterpartyId?: string | null
  dimensions?: Record<string, string> | null
}): string {
  return canonicalAccountingJson([
    line.glAccountId,
    line.direction,
    line.counterpartyType ?? null,
    line.counterpartyId ?? null,
    line.dimensions ?? {},
  ])
}

function assertExactContributions(
  members: PreparedEffectMember<AcceptedAccountingEffectBasisV1>[],
  lines: PreparedLine[],
  entry: BuiltEntry
) {
  const expected = new Map<string, bigint>()
  const actual = new Map<string, bigint>()
  for (const member of members)
    for (const line of member.acceptedBasis.contribution) {
      const key = contributionKey(line)
      expected.set(key, (expected.get(key) ?? 0n) + BigInt(line.amountMinor))
    }
  let debit = 0n
  let credit = 0n
  for (const line of lines) {
    if (!Number.isSafeInteger(line.resolved.amount) || line.resolved.amount <= 0)
      throw new UnprocessableEntityError('Journal amounts must be positive safe integers')
    const key = contributionKey(line.resolved)
    const amount = BigInt(line.resolved.amount)
    actual.set(key, (actual.get(key) ?? 0n) + amount)
    if (line.resolved.direction === 'debit') debit += amount
    else credit += amount
  }
  if (
    debit !== credit ||
    debit > BigInt(Number.MAX_SAFE_INTEGER) ||
    !Number.isSafeInteger(entry.totalDebit) ||
    !Number.isSafeInteger(entry.totalCredit) ||
    BigInt(entry.totalDebit) !== debit ||
    BigInt(entry.totalCredit) !== credit
  ) {
    throw new UnprocessableEntityError('Journal totals do not equal the exact member totals')
  }
  if (
    actual.size !== expected.size ||
    [...expected].some(([key, amount]) => actual.get(key) !== amount)
  )
    throw new ConflictError(
      'Journal lines do not equal the exact member contributions, accounts and dimensions'
    )
}

/**
 * The role scope frozen on one member's calculation (task 47 §5).
 *
 * 🛑 Delegates to preparation's own {@link documentRoleScope} rather than
 * deriving the scope a second time: a scope the two read differently refuses
 * every scoped posting with "an account role changed after preparation".
 *
 * ⚠️ An absent `sourceStoreId` reads as "not known", which resolves to the org
 * default.
 */
function effectRoleScope(basis: ReadyBasis): RoleSourceScope {
  const calculation = (basis as { calculation?: Record<string, unknown> }).calculation ?? {}
  return documentRoleScope({
    ...(calculation.sourceStoreId === undefined
      ? {}
      : { sourceStoreId: (calculation.sourceStoreId as string | null) ?? null }),
    ...(typeof calculation.paymentGatewayId === 'string'
      ? { paymentGatewayId: calculation.paymentGatewayId }
      : {}),
  })
}

async function assertDeliveryIntent(tx: Transaction, input: PreparedEffectPosting) {
  const active = await tx.query.ExternalBookConnection.findFirst({
    where: and(
      eq(schema.ExternalBookConnection.organizationId, input.organizationId),
      eq(schema.ExternalBookConnection.state, 'active')
    ),
  })
  if (input.deliveryIntent.kind === 'not_required') {
    if (active && input.entry.txnDate >= active.exportFromDate)
      throw new ConflictError('An active external book requires an explicit delivery intent')
    return
  }
  if (!active || active.id !== input.deliveryIntent.connectionId)
    throw new ConflictError(
      'The intended external book connection changed or is not active in this organization'
    )
  if (input.members.some((member) => member.acceptedBasis.effectiveDate < active.exportFromDate))
    throw new ConflictError('The journal predates the intended external book opening boundary')
}

async function assertCorrectionHead(
  tx: Transaction,
  organizationId: string,
  work: AccountingWorkEntity,
  expected: string | null | undefined
) {
  if (work.operation === 'original') {
    if (expected != null)
      throw new ConflictError('An original effect cannot name a correction head')
    return
  }
  if (expected === undefined || !work.correctsEffectId)
    throw new ConflictError('Correction work requires an expected correction head')
  const original = await tx
    .select({
      effectId: schema.AccountingEffect.id,
      entityInstanceId: schema.AccountingWork.entityInstanceId,
      moneyTransactionId: schema.AccountingWork.moneyTransactionId,
      operation: schema.AccountingWork.operation,
      effectKind: schema.AccountingWork.effectKind,
    })
    .from(schema.AccountingEffect)
    .innerJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, schema.AccountingEffect.organizationId),
        eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
      )
    )
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingEffect.id, work.correctsEffectId)
      )
    )
  if (
    original[0]?.operation !== 'original' ||
    original[0]?.effectKind !== work.effectKind ||
    (work.entityInstanceId !== null
      ? original[0]?.entityInstanceId !== work.entityInstanceId
      : original[0]?.moneyTransactionId !== work.moneyTransactionId)
  )
    throw new ConflictError('A correction must name the original effect of this owner')
  const prior = await tx
    .select({
      effectId: schema.AccountingEffect.id,
      workId: schema.AccountingWork.id,
      draft: schema.GlPosting.draft,
    })
    .from(schema.AccountingWork)
    .innerJoin(
      schema.AccountingEffect,
      and(
        eq(schema.AccountingEffect.organizationId, schema.AccountingWork.organizationId),
        eq(schema.AccountingEffect.workId, schema.AccountingWork.id)
      )
    )
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.organizationId, schema.AccountingEffect.organizationId),
        eq(schema.GlPosting.id, schema.AccountingEffect.glPostingId)
      )
    )
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.correctsEffectId, work.correctsEffectId)
      )
    )
  const next = new Map<string | null, string>()
  for (const correction of prior) {
    const member = readMembership(correction.draft).members.find(
      (m) => m.workId === correction.workId
    )
    if (!member || next.has(member.expectedCorrectionHeadId))
      throw new ConflictError('The saved correction chain has ambiguous ancestry')
    next.set(member.expectedCorrectionHeadId, correction.effectId)
  }
  let head: string | null = null
  let visited = 0
  while (next.has(head)) {
    head = next.get(head)!
    visited += 1
    if (visited > prior.length) throw new ConflictError('The saved correction chain is cyclic')
  }
  if (visited !== prior.length || head !== expected)
    throw new ConflictError('The correction head changed; recompute against the accepted history')
}

/** One frozen contribution line, as every accepted basis carries them. */
type ContributionLine = {
  glAccountId: string
  direction: 'debit' | 'credit'
  amountMinor: string
}

/** `account → signed minor`, debit positive. The shape a negation compares on. */
function netByAccount(contribution: readonly ContributionLine[]): Map<string, bigint> {
  const net = new Map<string, bigint>()
  for (const line of contribution) {
    const signed = (line.direction === 'debit' ? 1n : -1n) * BigInt(line.amountMinor)
    net.set(line.glAccountId, (net.get(line.glAccountId) ?? 0n) + signed)
  }
  return net
}

/**
 * A correction must be the EXACT negation of the effect it corrects.
 *
 * 🔑 **The invariant the ledger was missing.** Corrections have been
 * structurally supported since the beginning — `correctsEffectId`, heads,
 * ancestry — but nothing ever accepted one, so nothing ever checked what a
 * correction is allowed to contain. Without this, "correct effect X" could post
 * any balanced journal at all and still claim to reverse X.
 *
 * ⚠️ Compared per ACCOUNT, not per `lineKey`. A correction is free to arrive as
 * one line per account where the original used three (a tax split, say); what
 * must not differ is the net movement of every account it touches. Comparing
 * line keys would reject a correct reversal for cosmetic reasons.
 *
 * 🛑 Family-agnostic on purpose. Every one of the seven effect kinds gets this
 * for free, which is the whole reason it lives here and not in one policy's
 * schema — a schema cannot see the effect being corrected.
 */
async function assertCorrectionNegatesOriginal(
  tx: Transaction,
  organizationId: string,
  correctsEffectId: string,
  contribution: readonly ContributionLine[]
) {
  const [original] = await tx
    .select({ acceptedBasis: schema.AccountingEffect.acceptedBasis })
    .from(schema.AccountingEffect)
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingEffect.id, correctsEffectId)
      )
    )
    .limit(1)
  const originalContribution = (original?.acceptedBasis as { contribution?: ContributionLine[] })
    ?.contribution
  if (!originalContribution?.length)
    throw new ConflictError('The corrected effect has no frozen contribution to reverse')

  const was = netByAccount(originalContribution)
  const now = netByAccount(contribution)
  for (const account of new Set([...was.keys(), ...now.keys()]))
    if ((now.get(account) ?? 0n) !== -(was.get(account) ?? 0n))
      throw new ConflictError(
        'A correction must exactly reverse the effect it corrects, account for account'
      )
}

/**
 * Accept exact work membership, journal lines and delivery intent in the caller's transaction.
 * No provider, cache, queue or event calls occur. Domain refusals throw so the caller rolls back.
 * The required revalidator is supplied by the trusted domain writer; there is no
 * fallback that treats a preview as an authoritative source/configuration snapshot.
 * Manual/automatic is an explicit trusted command choice. The transaction validates the
 * active connection and export boundary; 45C must validate command eligibility and join
 * source/account/profile writes to the same locking protocol before switching live callers.
 */
export async function acceptEntryInTx(
  tx: Transaction,
  input: PreparedEffectPosting,
  dependencies: EffectAcceptanceDependencies
): Promise<AcceptedPostingResult | PostingReplanResult> {
  if (
    input.members.length === 0 ||
    new Set(input.members.map((m) => m.workId)).size !== input.members.length
  )
    throw new UnprocessableEntityError('Choose a nonempty set of distinct accounting work members')
  if (
    !['fulfillment', 'payment', 'credit_memo', MONEY_APPLICATION_POSTING_TYPE].includes(
      input.entry.postingType
    ) &&
    !DOCUMENT_EFFECT_POSTING_TYPES.has(input.entry.postingType)
  )
    throw new UnprocessableEntityError(
      'This acceptance policy supports fulfillment, customer money, credit and document accounting only'
    )
  let members = input.members
    .map((member) => ({
      ...member,
      acceptedBasis: member.acceptedBasis,
    }))
    .sort((a, b) => a.workId.localeCompare(b.workId))
  await withAccountingCommitLock(tx, input.organizationId)
  const workIds = members.map((m) => m.workId)
  const works = await tx
    .select()
    .from(schema.AccountingWork)
    .where(
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        inArray(schema.AccountingWork.id, workIds)
      )
    )
    .orderBy(schema.AccountingWork.id)
    .for('update')
  if (works.length !== members.length)
    throw new ConflictError('Accounting work is missing or belongs to another organization')
  const workById = new Map(works.map((w) => [w.id, w]))
  const expectedPostingType = {
    fulfillment_accounting: 'fulfillment',
    customer_receipt: 'payment',
    customer_refund: 'payment',
    customer_credit_issued: 'credit_memo',
    invoice_issued: DOCUMENT_EFFECT_FAMILY_SPEC.invoice_issued.postingType,
    invoice_write_off: DOCUMENT_EFFECT_FAMILY_SPEC.invoice_write_off.postingType,
    payout_settlement: DOCUMENT_EFFECT_FAMILY_SPEC.payout_settlement.postingType,
    expense_bill: DOCUMENT_EFFECT_FAMILY_SPEC.expense_bill.postingType,
    vendor_bill_matched: DOCUMENT_EFFECT_FAMILY_SPEC.vendor_bill_matched.postingType,
    inventory_receipt: DOCUMENT_EFFECT_FAMILY_SPEC.inventory_receipt.postingType,
    deposit_application: MONEY_APPLICATION_POSTING_TYPE,
  } as const
  if (works.some((work) => expectedPostingType[work.effectKind] !== input.entry.postingType))
    throw new ConflictError('Journal posting type does not match every accounting work owner')
  members = members.map((member) => {
    const work = workById.get(member.workId)
    if (!work) return member
    return { ...member, acceptedBasis: parseAcceptedBasis(work.effectKind, member.acceptedBasis) }
  })
  const sourceDates = members.map((member) => member.acceptedBasis.effectiveDate).sort()
  if (
    sourceDates.at(-1) !== input.entry.txnDate ||
    sourceDates.some((date) => date.slice(0, 7) !== input.entry.txnDate.slice(0, 7))
  ) {
    throw new ConflictError(
      'Journal date must be the latest member date within one accounting month'
    )
  }
  if (
    members.some((member) => member.acceptedBasis.policyKey !== 'fulfillment_current_v1') &&
    sourceDates.some((date) => date !== input.entry.txnDate)
  ) {
    throw new ConflictError('Daily accounting effects must all use the journal date')
  }
  const effects = await tx
    .select()
    .from(schema.AccountingEffect)
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, input.organizationId),
        inArray(schema.AccountingEffect.workId, workIds)
      )
    )
  const savedJournals =
    effects.length === 0
      ? []
      : await tx
          .select()
          .from(schema.GlPosting)
          .where(
            and(
              eq(schema.GlPosting.organizationId, input.organizationId),
              inArray(schema.GlPosting.id, [
                ...new Set(effects.map((effect) => effect.glPostingId)),
              ])
            )
          )
  const journalById = new Map(savedJournals.map((journal) => [journal.id, journal]))
  for (const effect of effects) {
    const member = members.find((m) => m.workId === effect.workId)!
    const journal = journalById.get(effect.glPostingId)
    if (!journal) throw new ConflictError('Accepted accounting refers to a missing journal')
    const savedMember = readMembership(journal.draft).members.find(
      (saved) => saved.workId === effect.workId
    )
    const work = workById.get(effect.workId)!
    if (
      !savedMember ||
      savedMember.effectKey !== work.effectKey ||
      savedMember.basisVersion !== effect.basisVersion ||
      savedMember.basisHash !== effect.basisHash ||
      (work.operation === 'correction' &&
        (member.expectedCorrectionHeadId === undefined ||
          savedMember.expectedCorrectionHeadId !== member.expectedCorrectionHeadId))
    )
      throw new ConflictError(
        'Accepted accounting differs from the requested membership or correction ancestry'
      )
    if (
      effect.basisVersion !== member.expectedBasisVersion ||
      effect.basisHash !== accountingBasisHash(member.acceptedBasis)
    )
      throw new ConflictError('Accepted accounting differs from the requested member basis')
  }
  if (effects.length === members.length) {
    const glPostingIds = [...new Set(effects.map((e) => e.glPostingId))].sort()
    const savedPostings = savedJournals
      .map((journal) => ({
        id: journal.id,
        deliveryIntent: journal.deliveryIntent,
        connectionId: journal.intendedBookConnectionId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    if (savedPostings.length !== glPostingIds.length)
      throw new ConflictError('Accepted accounting refers to a missing journal')
    const postings = savedPostings.map((saved) => {
      let deliveryIntent: PostingDeliveryIntent
      if (saved.deliveryIntent === 'not_required' && saved.connectionId === null)
        deliveryIntent = { kind: 'not_required' }
      else if (
        (saved.deliveryIntent === 'manual' || saved.deliveryIntent === 'automatic') &&
        saved.connectionId
      )
        deliveryIntent = { kind: saved.deliveryIntent, connectionId: saved.connectionId }
      else throw new ConflictError('Accepted journal has no valid pinned delivery intent')
      return { glPostingId: saved.id, deliveryIntent }
    })
    return {
      status: 'accepted',
      existing: true,
      glPostingIds,
      glPostingId: glPostingIds.length === 1 ? glPostingIds[0] : undefined,
      effectIds: effects.map((e) => e.id).sort(),
      postings,
      deliveryIntent: postings.length === 1 ? postings[0]!.deliveryIntent : undefined,
    }
  }
  if (effects.length > 0) {
    const acceptedWorkIds = effects.map((e) => e.workId).sort()
    return {
      status: 'replan',
      acceptedWorkIds,
      remainingWorkIds: workIds.filter((id) => !acceptedWorkIds.includes(id)),
    }
  }
  const lock = await resolvePeriodLock(input.organizationId, tx)
  await assertDeliveryIntent(tx, input)
  const corrections = new Set<string>()
  for (const member of members) {
    const work = workById.get(member.workId)!
    if (
      !Object.hasOwn(expectedPostingType, work.effectKind) ||
      !['pending', 'blocked'].includes(work.state) ||
      work.eligibility === 'excluded'
    )
      throw new ConflictError('The selected work is not eligible for accounting acceptance')
    if (work.basisVersion !== member.expectedBasisVersion)
      throw new ConflictError('The selected accounting basis version changed')
    if (work.correctsEffectId && corrections.has(work.correctsEffectId))
      throw new ConflictError('Accept corrections to the same original in separate commands')
    if (work.correctsEffectId) corrections.add(work.correctsEffectId)
    await assertCorrectionHead(tx, input.organizationId, work, member.expectedCorrectionHeadId)
    if (work.correctsEffectId)
      await assertCorrectionNegatesOriginal(
        tx,
        input.organizationId,
        work.correctsEffectId,
        (member.acceptedBasis as { contribution: ContributionLine[] }).contribution
      )
    const saved = await tx.query.AccountingWorkBasis.findFirst({
      where: and(
        eq(schema.AccountingWorkBasis.organizationId, input.organizationId),
        eq(schema.AccountingWorkBasis.workId, work.id),
        eq(schema.AccountingWorkBasis.version, work.basisVersion)
      ),
    })
    if (!saved) throw new ConflictError('The selected accounting input basis is missing')
    const basis = accountingWorkBasisSchemaV1.parse(saved.basis)
    if (basis.status !== 'ready')
      throw new UnprocessableEntityError('Accounting dependencies are incomplete')
    const acceptedBasis = parseAcceptedBasis(work.effectKind, member.acceptedBasis)
    const commonMismatch =
      saved.sourceHash !== basis.sourceHash ||
      saved.effectiveDate !== basis.effectiveDate ||
      acceptedBasis.sourceBasisVersion !== work.basisVersion ||
      acceptedBasis.sourceHash !== basis.sourceHash ||
      acceptedBasis.effectiveDate !== basis.effectiveDate
    let ownerMismatch = basis.status !== 'ready'
    if (!ownerMismatch && work.effectKind === 'fulfillment_accounting') {
      const fulfillmentBasis = basis as Extract<ReadyBasis, { fulfillmentInstanceId: string }>
      ownerMismatch =
        fulfillmentBasis.fulfillmentInstanceId !== work.entityInstanceId ||
        !isFulfillmentBasis(acceptedBasis) ||
        accountingBasisHash(acceptedBasis.calculation) !==
          accountingBasisHash(fulfillmentBasis.calculation)
    }
    if (!ownerMismatch && work.effectKind === 'customer_receipt') {
      const receiptBasis = basis as Extract<ReadyBasis, { moneyTransactionId: string }>
      ownerMismatch =
        receiptBasis.moneyTransactionId !== work.moneyTransactionId ||
        !isReceiptBasis(acceptedBasis) ||
        accountingBasisHash(acceptedBasis.calculation) !==
          accountingBasisHash(receiptBasis.calculation)
      // 🔑 The direction check the schema gave up so corrections could exist.
      // An ORIGINAL receipt debits its cash account — money arriving is an asset
      // going up. Only a correction is allowed to run the other way, and what
      // constrains that one is the negation check below.
      if (!ownerMismatch && work.operation === 'original' && isReceiptBasis(acceptedBasis)) {
        const cashGlAccountId =
          'kind' in acceptedBasis.calculation
            ? acceptedBasis.calculation.cashGlAccountId
            : acceptedBasis.calculation.route.glAccountId
        if (
          !acceptedBasis.contribution.some(
            (line) => line.direction === 'debit' && line.glAccountId === cashGlAccountId
          )
        )
          throw new ConflictError('An original receipt must debit its cash account')
      }
    }
    if (!ownerMismatch && work.effectKind === 'customer_credit_issued') {
      ownerMismatch =
        !('creditMemoInstanceId' in basis) ||
        basis.creditMemoInstanceId !== work.entityInstanceId ||
        acceptedBasis.policyKey !== 'customer_credit_issued_v1' ||
        accountingBasisHash(acceptedBasis.calculation) !== accountingBasisHash(basis.calculation)
    }
    if (!ownerMismatch && isDocumentEffectFamily(work.effectKind)) {
      // 🛑 The family is checked on BOTH sides. The work's `effectKind` is what
      // the CHECK constraint and the partial unique key on
      // `(organizationId, entityInstanceId, effectKind)` enforce; the
      // calculation's `family` is what the accepted basis carries forever. A
      // journal that agrees with one and not the other is the drift a single
      // shared contract could otherwise let through.
      const family: DocumentEffectFamily = work.effectKind
      ownerMismatch =
        !('documentInstanceId' in basis) ||
        basis.documentInstanceId !== work.entityInstanceId ||
        basis.family !== family ||
        !isDocumentBasis(acceptedBasis) ||
        acceptedBasis.calculation.family !== family ||
        acceptedBasis.calculation.documentKey !== input.entry.periodKey ||
        accountingBasisHash(acceptedBasis.calculation) !== accountingBasisHash(basis.calculation)
    }
    if (!ownerMismatch && work.effectKind === 'deposit_application') {
      // 🛑 The invoice is checked as a REFERENCE, not as the owner. The owner is
      // `moneyTransactionId`, checked below with the other money families; what
      // must not drift is which application this journal froze.
      ownerMismatch =
        !('moneyApplicationId' in basis) ||
        basis.moneyTransactionId !== work.moneyTransactionId ||
        !isMoneyApplicationBasis(acceptedBasis) ||
        acceptedBasis.calculation.moneyApplicationId !== basis.moneyApplicationId ||
        !acceptedBasis.documentRefs.some(
          (ref) =>
            ref.resourceKind === MONEY_APPLICATION_RESOURCE_KIND &&
            ref.entityInstanceId === acceptedBasis.calculation.invoiceInstanceId
        ) ||
        accountingBasisHash(acceptedBasis.calculation) !== accountingBasisHash(basis.calculation)
    }
    if (!ownerMismatch && work.effectKind === 'customer_refund') {
      ownerMismatch =
        !('moneyTransactionId' in basis) ||
        basis.moneyTransactionId !== work.moneyTransactionId ||
        acceptedBasis.policyKey !== 'customer_refund_v1' ||
        accountingBasisHash(acceptedBasis.calculation) !== accountingBasisHash(basis.calculation)
    }
    if (commonMismatch || ownerMismatch)
      throw new ConflictError('Accepted calculation differs from the selected source basis')
    if (work.entityInstanceId !== null) {
      const entityType = ownerEntityType(work.effectKind)
      const [source] = await tx
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .innerJoin(
          schema.EntityDefinition,
          and(
            eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
            eq(schema.EntityDefinition.organizationId, input.organizationId)
          )
        )
        .where(
          and(
            eq(schema.EntityInstance.organizationId, input.organizationId),
            eq(schema.EntityInstance.id, work.entityInstanceId!),
            eq(schema.EntityDefinition.entityType, entityType),
            isNull(schema.EntityInstance.archivedAt),
            isNull(schema.EntityDefinition.archivedAt)
          )
        )
        .limit(1)
      if (!source) throw new ConflictError(`The accounting source is not a live ${entityType}`)
    } else {
      const [source] = await tx
        .select({ id: schema.MoneyTransaction.id })
        .from(schema.MoneyTransaction)
        .where(
          and(
            eq(schema.MoneyTransaction.organizationId, input.organizationId),
            eq(schema.MoneyTransaction.id, work.moneyTransactionId!),
            eq(
              schema.MoneyTransaction.purpose,
              work.effectKind === 'customer_refund' ? 'customer_refund' : 'customer_receipt'
            )
          )
        )
        .limit(1)
      if (!source)
        throw new ConflictError('The accounting source is not the expected customer movement')
    }
    const revalidated = parseAcceptedBasis(
      work.effectKind,
      await dependencies.revalidateMemberInTx(tx, work, basis)
    )
    if (accountingBasisHash(revalidated) !== accountingBasisHash(acceptedBasis))
      throw new ConflictError('The source or accounting configuration changed after preparation')
    if (
      acceptedBasis.accountResolution.some(
        (resolution) => resolution.selectedBy === 'org_role' && resolution.accountRole === null
      )
    )
      throw new UnprocessableEntityError(
        'An organization-role selection must name its account role'
      )
    const roles = acceptedBasis.accountResolution.filter(
      (r) => r.selectedBy === 'org_role' && r.accountRole !== null
    )
    // 🛑 Re-resolved through the SAME scope the preparation used, off the
    // frozen calculation rather than off anything read again (task 47 §5). A
    // per-store revenue account resolved at prepare time and re-checked against
    // the ORG DEFAULT here would report "an account role changed after
    // preparation" on every scoped shipment - a refusal describing a change
    // nobody made.
    const resolved = await resolveRoles(
      tx,
      input.organizationId,
      roles.map((r) => r.accountRole!),
      effectRoleScope(basis)
    )
    if (resolved.isErr()) throw new UnprocessableEntityError(resolved.error.message)
    if (roles.some((r) => resolved.value.get(r.accountRole!)?.glAccountId !== r.glAccountId))
      throw new ConflictError('An account role changed after preparation')
  }
  const membershipHash = accountingBasisHash({
    organizationId: input.organizationId,
    members: members
      .map((m) => ({
        effectKey: workById.get(m.workId)!.effectKey,
        basisVersion: m.expectedBasisVersion,
      }))
      .sort((a, b) => a.effectKey.localeCompare(b.effectKey)),
    representation: 'journal',
    effectiveDate: input.entry.txnDate,
  })
  // 🛑 A document family keeps its own period key rather than the membership
  // hash a fulfillment batch uses, so `AUXX-INI-INV-0042` reads instead of
  // `AUXX-INI-g1a2b3c4d`. That key is the document's own number, forever — but
  // a reversal frees `(postingType, periodKey, 0)` without freeing the key
  // itself, so a re-post walks generations (`documentGenerationKey`) past every
  // one a reversal already vacated. The owner check above still pins every
  // member's `documentKey` to the bare `input.entry.periodKey`, unaffected.
  const documentGroup = works.every((work) => isDocumentEffectFamily(work.effectKind))
  let documentPeriodKey = input.entry.periodKey
  if (documentGroup) {
    const priorClaims = await tx
      .select({ periodKey: schema.GlPosting.periodKey, status: schema.GlPosting.status })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, input.organizationId),
          eq(schema.GlPosting.postingType, input.entry.postingType),
          eq(schema.GlPosting.revision, 0),
          or(
            eq(schema.GlPosting.periodKey, input.entry.periodKey),
            like(schema.GlPosting.periodKey, `${input.entry.periodKey}.%`)
          )
        )
      )
    const statusByKey = new Map(priorClaims.map((row) => [row.periodKey, row.status]))
    let generation = 1
    while (statusByKey.get(documentGenerationKey(input.entry.periodKey, generation)) === 'reversed')
      generation++
    documentPeriodKey = documentGenerationKey(input.entry.periodKey, generation)
  }
  const entry = {
    ...input.entry,
    periodKey: documentGroup ? documentPeriodKey : fulfillmentGroupPeriodKey(membershipHash),
  }
  const prepared = await prepareEntry(tx, {
    organizationId: input.organizationId,
    entry,
    lock,
    revision: 0,
  })
  if (prepared.refusal) throw new UnprocessableEntityError(prepared.refusal.error)
  assertExactContributions(members, prepared.lines, entry)
  const membership: PostingAccountingMembership = {
    version: 1,
    membershipHash,
    representation: 'journal',
    members: members.map((m) => ({
      workId: m.workId,
      effectKey: workById.get(m.workId)!.effectKey,
      basisVersion: m.expectedBasisVersion,
      basisHash: accountingBasisHash(m.acceptedBasis),
      expectedCorrectionHeadId: m.expectedCorrectionHeadId ?? null,
    })),
  }
  const claim = await insertPostingInTx(tx, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    memo: input.memo,
    entry,
    revision: 0,
    docNumber: prepared.docNumber,
    requestId: prepared.requestId,
    totalMinor: prepared.totalMinor,
    lines: prepared.lines,
    deliveryIntent: input.deliveryIntent,
    accountingMembership: membership,
  }).catch((error: unknown) => {
    const constraint = uniqueViolationConstraint(error)
    if (constraint !== null)
      throw new ConflictError(
        `The journal identity or document number conflicts with an existing posting (${constraint || 'unique constraint'})`
      )
    throw error
  })
  if (claim.kind === 'existing') {
    const saved = readMembership(claim.row.draft)
    if (saved.membershipHash !== membershipHash)
      throw new ConflictError('The journal identity collided with a different membership hash')
    throw new ConflictError(
      'A journal exists without the requested accepted effect membership; repair it before posting'
    )
  }
  const accepted = await tx
    .insert(schema.AccountingEffect)
    .values(
      members.map((member) => ({
        organizationId: input.organizationId,
        workId: member.workId,
        basisVersion: member.expectedBasisVersion,
        glPostingId: claim.row.id,
        effectiveDate: member.acceptedBasis.effectiveDate,
        currency: member.acceptedBasis.currency,
        currencyExponent: member.acceptedBasis.currencyExponent,
        acceptedBasis: member.acceptedBasis,
        basisHash: accountingBasisHash(member.acceptedBasis),
      }))
    )
    .returning({ id: schema.AccountingEffect.id })
  await tx
    .update(schema.AccountingWork)
    .set({
      state: 'accepted',
      blockedReason: null,
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        inArray(schema.AccountingWork.id, workIds)
      )
    )
  return {
    status: 'accepted',
    existing: false,
    glPostingId: claim.row.id,
    glPostingIds: [claim.row.id],
    effectIds: accepted.map((e) => e.id).sort(),
    deliveryIntent: input.deliveryIntent,
    postings: [{ glPostingId: claim.row.id, deliveryIntent: input.deliveryIntent }],
  }
}
