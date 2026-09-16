// packages/lib/src/postings/delivery.ts
import { randomUUID } from 'node:crypto'
import {
  type AccountingDeliveryOperationEntity,
  type Database,
  schema,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  type QuickbooksToolContext,
  resolveQuickbooksContext,
} from '../money/quickbooks/invoke-quickbooks-tool'
import { toNeutralPartyType } from '../money/quickbooks/object-types'
import { prepareQuickbooksJournal } from '../money/quickbooks/quickbooks-accounting-provider'
import { withAccountingCommitLock } from './accounting-commit-lock'
import { readPinnedAccountingConnection } from './book-connections'
import { assertCoveragePartitionsInTx } from './delivery-coverage'
import {
  preparedJournalSchema,
  quickbooksJournalWirePayload,
  verifyDeliveredJournal,
} from './delivery-proof'
import { accountingBasisHash } from './effect-basis'
import type { CounterpartyType, PostEntryInput, PostResult } from './types'

const LEASE_MS = 5 * 60_000
const RETRY_MS = 60_000
const scoped = (
  table: { organizationId: AnyPgColumn; id: AnyPgColumn },
  organizationId: string,
  id: string
) => and(eq(table.organizationId, organizationId), eq(table.id, id))
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const logger = createScopedLogger('accounting-delivery')
/** How long an acceptance will wait on the queue before leaving it to the sweep. */
const ENQUEUE_TIMEOUT_MS = 2_000

/** Plan complete-effect coverage before any provider work; caller owns the transaction. */
export async function planAccountingDeliveryInTx(
  tx: Transaction,
  input: { organizationId: string; glPostingId: string; manual?: boolean }
) {
  const { organizationId, glPostingId } = input
  await withAccountingCommitLock(tx, organizationId)
  const [posting] = await tx
    .select()
    .from(schema.GlPosting)
    .where(scoped(schema.GlPosting, organizationId, glPostingId))
    .limit(1)
  if (!posting) throw new Error('Posting not found')
  if (!posting.deliveryIntent)
    throw new Error('Legacy posting requires explicit delivery classification')
  if (posting.deliveryIntent === 'not_required') return null
  if (!posting.intendedBookConnectionId) throw new Error('Posting has no pinned destination')
  const [connection] = await tx
    .select()
    .from(schema.ExternalBookConnection)
    .where(scoped(schema.ExternalBookConnection, organizationId, posting.intendedBookConnectionId))
    .limit(1)
  if (!connection) throw new Error('Pinned accounting connection is missing')
  const effects = await tx
    .select({ id: schema.AccountingEffect.id })
    .from(schema.AccountingEffect)
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingEffect.glPostingId, glPostingId)
      )
    )
  if (!effects.length) throw new Error('Posting has no accepted accounting effects')
  let [delivery] = await tx
    .select()
    .from(schema.AccountingDelivery)
    .where(
      and(
        eq(schema.AccountingDelivery.organizationId, organizationId),
        eq(schema.AccountingDelivery.bookId, connection.bookId),
        eq(schema.AccountingDelivery.glPostingId, glPostingId)
      )
    )
    .limit(1)
  if (!delivery) {
    ;[delivery] = await tx
      .insert(schema.AccountingDelivery)
      .values({
        organizationId,
        bookId: connection.bookId,
        connectionId: connection.id,
        glPostingId,
        representation: 'journal',
        state: 'pending',
        releasedAt: posting.deliveryIntent === 'automatic' || input.manual ? new Date() : null,
      })
      .returning()
    await tx.insert(schema.AccountingDeliveryCoverage).values(
      effects.map((effect) => ({
        organizationId,
        bookId: connection.bookId,
        deliveryId: delivery!.id,
        effectId: effect.id,
        componentKey: 'whole_effect',
      }))
    )
    await tx.insert(schema.AccountingDeliveryOperation).values({
      organizationId,
      deliveryId: delivery!.id,
      operationKey: 'journal',
      objectType: 'journal',
      requestId: posting.requestId,
      state: 'pending',
    })
  } else if (input.manual && !delivery.releasedAt) {
    ;[delivery] = await tx
      .update(schema.AccountingDelivery)
      .set({ releasedAt: new Date() })
      .where(scoped(schema.AccountingDelivery, organizationId, delivery.id))
      .returning()
  }
  if (!delivery) throw new Error('Delivery creation returned no row')
  // 🛑 Brief 44 §7: coverage must PARTITION each effect's contribution before
  // anything is sent. The commit lock above is already held, so this read sees a
  // settled picture of every plan claiming these effects in this book - including
  // plans this transaction did not write.
  //
  // 🔑 This runs on EVERY delivery attempt, not only the one that creates the
  // plan: `deliverAccountingPosting` re-plans first, and the assertion sits
  // after the create/release branches deliberately. So a plan that sat `blocked`
  // for a week while its coverage was replaced is re-proved, inside the lock,
  // immediately before the send - which is why no second check is needed at the
  // send site.
  await assertCoveragePartitionsInTx(tx, {
    organizationId,
    bookId: connection.bookId,
    effectIds: effects.map((effect) => effect.id),
  })
  return { posting, delivery }
}

async function loadInput(
  db: Database,
  organizationId: string,
  glPostingId: string
): Promise<PostEntryInput> {
  const [posting] = await db
    .select()
    .from(schema.GlPosting)
    .where(scoped(schema.GlPosting, organizationId, glPostingId))
    .limit(1)
  if (!posting) throw new Error('Posting not found')
  const rows = await db
    .select()
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.glPostingId, glPostingId)
      )
    )
    .orderBy(asc(schema.GlPostingLine.lineNumber))
  if (!rows.length) throw new Error('Posting has no frozen journal lines')
  const draft = posting.draft as { memo?: unknown } | null
  return {
    organizationId,
    glPostingId,
    postingType: posting.postingType,
    periodKey: posting.periodKey,
    revision: posting.revision,
    txnDate: posting.txnDate,
    docNumber: posting.docNumber,
    idempotencyKey: posting.requestId,
    ...(typeof draft?.memo === 'string' ? { memo: draft.memo } : {}),
    lines: rows.map((line) => ({
      glAccountId: line.glAccountId,
      accountCode: line.accountCode,
      amount: line.amountMinor,
      direction: line.direction,
      sortOrder: line.lineNumber,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      memo: line.memo ?? undefined,
      counterpartyType: (line.counterpartyType as CounterpartyType | null) ?? undefined,
      counterpartyId: line.counterpartyId ?? undefined,
      dimensions: line.dimensions as Record<string, string> | undefined,
    })),
  }
}

async function claim(db: Database, organizationId: string, deliveryId: string) {
  return db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)
    const [operation] = await tx
      .select()
      .from(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, organizationId),
          eq(schema.AccountingDeliveryOperation.deliveryId, deliveryId),
          eq(schema.AccountingDeliveryOperation.operationKey, 'journal')
        )
      )
      .limit(1)
    if (!operation) throw new Error('Journal operation is missing')
    if (operation.state === 'succeeded') return { operation, token: null }
    if (operation.leaseExpiresAt && operation.leaseExpiresAt > new Date()) return null
    const token = randomUUID()
    await tx
      .update(schema.AccountingDeliveryOperation)
      .set({
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        attempts: operation.attempts + 1,
      })
      .where(scoped(schema.AccountingDeliveryOperation, organizationId, operation.id))
    return { operation, token }
  })
}

async function updateOwned(
  db: Database,
  operation: AccountingDeliveryOperationEntity,
  token: string,
  values: Partial<typeof schema.AccountingDeliveryOperation.$inferInsert>
) {
  const rows = await db
    .update(schema.AccountingDeliveryOperation)
    .set(values)
    .where(
      and(
        eq(schema.AccountingDeliveryOperation.organizationId, operation.organizationId),
        eq(schema.AccountingDeliveryOperation.id, operation.id),
        eq(schema.AccountingDeliveryOperation.leaseToken, token)
      )
    )
    .returning({ id: schema.AccountingDeliveryOperation.id })
  if (!rows.length) throw new Error('Delivery lease was lost')
}

/** Explicitly bound context; every tool request rechecks the saved connection without redirecting. */
async function contextFor(db: Database, organizationId: string, connectionId: string) {
  const pinned = await readPinnedAccountingConnection(db, organizationId, connectionId)
  const resolved = await resolveQuickbooksContext({
    organizationId,
    pinnedCredentialId: pinned.credentialId,
    expectedCompanyId: pinned.companyId,
  })
  if (!resolved.connected) throw new Error('Pinned QuickBooks connection is unavailable')
  const ctx = resolved.context
  if (ctx.installationId !== pinned.appInstallationId)
    throw new Error('Pinned accounting installation changed')
  const call = ctx.callTool
  ctx.callTool = async (toolId, inputs) => {
    const live = await readPinnedAccountingConnection(db, organizationId, connectionId)
    if (live.credentialId !== ctx.connectionId || live.companyId !== ctx.realmId)
      throw new Error('Pinned QuickBooks binding changed')
    return call(toolId, inputs)
  }
  return { ctx, pinned }
}

function requireInput(ctx: QuickbooksToolContext, toolId: string, field: string) {
  const properties = ctx.tools?.find((tool) => tool.id === toolId)?.inputsJsonSchema.properties
  if (!properties || typeof properties !== 'object' || !(field in properties))
    throw new Error(
      `Installed QuickBooks tool ${toolId} does not support ${field}; update the app deployment before exporting`
    )
}

function requireJournalReadback(ctx: QuickbooksToolContext) {
  const output = ctx.tools?.find((tool) => tool.id === 'find_quickbooks_journal_entry')
    ?.outputsJsonSchema as
    | { properties?: { journalEntries?: { items?: { properties?: Record<string, unknown> } } } }
    | undefined
  const fields = output?.properties?.journalEntries?.items?.properties
  if (
    !fields ||
    [
      'journalEntryId',
      'docNumber',
      'txnDate',
      'currency',
      'lines',
      'privateNote',
      'syncToken',
    ].some((field) => !(field in fields))
  ) {
    throw new Error(
      'Installed QuickBooks journal lookup lacks the full accounting readback contract'
    )
  }
}

async function saveSuccess(
  db: Database,
  operation: AccountingDeliveryOperationEntity,
  token: string,
  input: {
    bookId: string
    deliveryId: string
    glPostingId: string
    companyId: string
    remote: Record<string, unknown>
    externalId: string
  }
) {
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, operation.organizationId)
    const [owned] = await tx
      .select()
      .from(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.id, operation.id),
          eq(schema.AccountingDeliveryOperation.organizationId, operation.organizationId),
          eq(schema.AccountingDeliveryOperation.leaseToken, token)
        )
      )
      .limit(1)
    if (!owned) throw new Error('Delivery lease was lost before saving provider outcome')
    const coverage = await tx
      .select({ effectId: schema.AccountingDeliveryCoverage.effectId })
      .from(schema.AccountingDeliveryCoverage)
      .where(
        and(
          eq(schema.AccountingDeliveryCoverage.organizationId, operation.organizationId),
          eq(schema.AccountingDeliveryCoverage.deliveryId, input.deliveryId)
        )
      )
    await tx.insert(schema.ExternalAccountingObject).values({
      organizationId: operation.organizationId,
      bookId: input.bookId,
      operationId: operation.id,
      objectType: 'journal',
      externalId: input.externalId,
      author: 'auxx',
      remoteVersion: typeof input.remote.syncToken === 'string' ? input.remote.syncToken : null,
      remoteBasis: input.remote,
      componentCoverage: coverage.map((row) => row.effectId),
    })
    await tx
      .update(schema.AccountingDeliveryOperation)
      .set({
        state: 'succeeded',
        outcome: input.remote,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        failureReason: null,
      })
      .where(scoped(schema.AccountingDeliveryOperation, operation.organizationId, operation.id))
    await tx
      .update(schema.AccountingDelivery)
      .set({ state: 'delivered', completedAt: new Date() })
      .where(scoped(schema.AccountingDelivery, operation.organizationId, input.deliveryId))
    await tx
      .update(schema.GlPosting)
      .set({
        exportStatus: 'exported',
        providerId: 'quickbooks',
        providerEntryId: input.externalId,
        providerTenantId: input.companyId,
        failureReason: null,
      })
      .where(scoped(schema.GlPosting, operation.organizationId, input.glPostingId))
  })
}

/** Deliver an accepted journal after its outermost transaction commits; uncertainty never authorizes a second create. */
/**
 * Hand one accepted journal to the delivery worker instead of exporting it here.
 *
 * 🛑 Call this from an acceptance, NOT {@link deliverAccountingPosting}. An
 * export is 3 to 5 sequential Lambda round trips to a rate-limited third party,
 * and an acceptance is usually running inside somebody's HTTP request - a bulk
 * fulfillment run makes one export per GROUP, which is what turned a 28-group
 * posting into a multi-minute dialog.
 *
 * Losing the enqueue is survivable and deliberately not fatal: the acceptance
 * has already committed its `AccountingDelivery` row, and
 * `sweepAccountingDeliveries` exists to find exactly the rows nothing woke up
 * for. The queue is an optimisation on WHEN, never the only path.
 */
export async function enqueueAccountingDelivery(input: {
  organizationId: string
  glPostingId: string
}): Promise<void> {
  try {
    const { getQueue, Queues } = await import('../jobs/queues')
    const queued = getQueue(Queues.accountingDeliveryQueue)
      .add('accounting-delivery', input, {
        // One job per posting. A retried acceptance that re-enters here with the
        // same journal collapses onto the job still queued rather than racing a
        // second export against the first one's lease.
        jobId: `accounting-delivery:${input.organizationId}:${input.glPostingId}`,
      })
      // Settled below either way; this keeps a late rejection from surfacing as
      // an unhandled one after the race has already moved on.
      .catch((error) => {
        logger.warn('Could not enqueue an accounting delivery; recovery will pick it up', {
          ...input,
          error: message(error),
        })
      })

    // 🛑 BOUNDED, and this is the whole point of the function. `add()` talks to
    // Redis, and ioredis retries a refused connection forever rather than
    // failing - so an unbounded await here hands the acceptance a new way to
    // hang, which is precisely what moving delivery off the request path was
    // meant to remove. A sick queue must cost this call a couple of seconds and
    // nothing else.
    //
    // Dropping the job is safe by construction: the acceptance has already
    // committed its `AccountingDelivery` row, and `sweepAccountingDeliveries`
    // exists to find rows nothing woke up for. Late delivery, never lost.
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = Symbol('expired')
    const result = await Promise.race([
      queued,
      new Promise<typeof expired>((resolve) => {
        timer = setTimeout(() => resolve(expired), ENQUEUE_TIMEOUT_MS)
      }),
    ])
    if (timer) clearTimeout(timer)
    if (result === expired)
      logger.warn('Enqueueing an accounting delivery timed out; recovery will pick it up', {
        ...input,
        timeoutMs: ENQUEUE_TIMEOUT_MS,
      })
  } catch (error) {
    logger.warn('Could not enqueue an accounting delivery; recovery will pick it up', {
      ...input,
      error: message(error),
    })
  }
}

export async function deliverAccountingPosting(
  db: Database,
  input: { organizationId: string; glPostingId: string; manual?: boolean }
): Promise<PostResult> {
  const planned = await db.transaction((tx) => planAccountingDeliveryInTx(tx, input))
  if (!planned)
    return { status: 'posted', exportStatus: 'not_required', glPostingId: input.glPostingId }
  const { posting, delivery } = planned
  const base = { glPostingId: posting.id, docNumber: posting.docNumber, providerId: 'quickbooks' }
  if (!delivery.releasedAt) return { ...base, status: 'posted', exportStatus: 'pending' }
  const claimed = await claim(db, input.organizationId, delivery.id)
  if (!claimed) return { ...base, status: 'posted', exportStatus: 'pending' }
  let { operation } = claimed
  const { token } = claimed
  if (!token) return { ...base, status: 'already_posted', exportStatus: 'exported' }
  let possibleSend = operation.firstSentAt !== null
  try {
    const { ctx, pinned } = await contextFor(db, input.organizationId, delivery.connectionId)
    requireInput(ctx, 'create_quickbooks_journal_entry', 'requestId')
    requireInput(ctx, 'create_quickbooks_journal_entry', 'currency')
    requireJournalReadback(ctx)
    if (!operation.payload || !operation.firstSentAt) {
      await recoverCustomerDependencies(db, operation, pinned.bookId, ctx)
      const durableContext = {
        ...ctx,
        callTool: async (toolId: string, values: Record<string, unknown>) => {
          if (toolId === 'create_quickbooks_customer')
            return createCustomerDependency(db, {
              operation,
              token,
              bookId: pinned.bookId,
              ctx,
              values,
            })
          if (toolId.startsWith('create_') || toolId.startsWith('update_'))
            throw new Error(`Unplanned accounting dependency write: ${toolId}`)
          return ctx.callTool(toolId, values)
        },
      }
      const prepared = await prepareQuickbooksJournal(
        durableContext,
        await loadInput(db, input.organizationId, posting.id)
      )
      const payload = preparedJournalSchema.parse(prepared.toolInput)
      const dependencies = await db
        .select({
          id: schema.AccountingDeliveryOperation.id,
          state: schema.AccountingDeliveryOperation.state,
        })
        .from(schema.AccountingDeliveryOperation)
        .where(
          and(
            eq(schema.AccountingDeliveryOperation.organizationId, input.organizationId),
            eq(schema.AccountingDeliveryOperation.deliveryId, delivery.id),
            eq(schema.AccountingDeliveryOperation.objectType, 'customer')
          )
        )
      if (dependencies.some((d) => d.state !== 'succeeded'))
        throw new Error('A customer dependency has an unresolved outcome')
      const mappingBasis = {
        ...prepared.mappingBasis,
        serverBundleSha: ctx.serverBundleSha,
        wirePayload: quickbooksJournalWirePayload(payload),
      }
      await updateOwned(db, operation, token, {
        payload,
        payloadHash: accountingBasisHash(payload),
        mappingBasis,
        dependencies: dependencies.map((d) => d.id),
        state: 'prepared',
      })
      operation = { ...operation, payload, payloadHash: accountingBasisHash(payload), mappingBasis }
    }
    if (accountingBasisHash(operation.payload) !== operation.payloadHash)
      throw new Error('Saved delivery payload hash does not match')
    const payload = preparedJournalSchema.parse(operation.payload)
    const mapping = operation.mappingBasis as { serverBundleSha?: string }
    if (!mapping?.serverBundleSha || mapping.serverBundleSha !== ctx.serverBundleSha)
      throw new Error(
        'QuickBooks deployment changed after payload preparation; saved request requires its original tool deployment'
      )
    const found = await ctx.callTool('find_quickbooks_journal_entry', {
      docNumber: payload.docNumber,
      limit: 2,
    })
    if (!Array.isArray(found?.journalEntries))
      throw new Error('QuickBooks journal readback did not return a complete result')
    if (found.journalEntries.length > 1)
      throw new Error('More than one QuickBooks journal has this document number')
    let remote: unknown = found.journalEntries[0]
    if (!remote) {
      if (possibleSend)
        throw new Error(
          'Previous journal send has an unknown outcome; no matching remote journal is visible yet'
        )
      await updateOwned(db, operation, token, { state: 'sending', firstSentAt: new Date() })
      possibleSend = true
      const result = await ctx.callTool('create_quickbooks_journal_entry', payload)
      remote = result?.journalEntry
    }
    const verified = verifyDeliveredJournal({
      prepared: payload,
      remote,
      intendedCompanyId: pinned.companyId,
      actualCompanyId: ctx.realmId ?? '',
      toNeutralParty: toNeutralPartyType,
    })
    await saveSuccess(db, operation, token, {
      bookId: pinned.bookId,
      deliveryId: delivery.id,
      glPostingId: posting.id,
      companyId: pinned.companyId,
      remote: verified,
      externalId: verified.journalEntryId,
    })
    return {
      ...base,
      status: 'posted',
      exportStatus: 'exported',
      providerEntryId: verified.journalEntryId,
      providerTenantId: pinned.companyId,
    }
  } catch (error) {
    const reason = message(error)
    await db.transaction(async (tx) => {
      const changed = await tx
        .update(schema.AccountingDeliveryOperation)
        .set({
          state: possibleSend ? 'uncertain' : 'blocked',
          failureReason: reason,
          nextAttemptAt: new Date(Date.now() + RETRY_MS),
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(schema.AccountingDeliveryOperation.organizationId, input.organizationId),
            eq(schema.AccountingDeliveryOperation.id, operation.id),
            eq(schema.AccountingDeliveryOperation.leaseToken, token)
          )
        )
        .returning({ id: schema.AccountingDeliveryOperation.id })
      if (!changed.length) return
      await tx
        .update(schema.AccountingDelivery)
        .set({ state: 'blocked' })
        .where(scoped(schema.AccountingDelivery, input.organizationId, delivery.id))
      await tx
        .update(schema.GlPosting)
        .set({
          exportStatus: 'failed',
          failureReason: reason,
          attempts: sql`${schema.GlPosting.attempts} + 1`,
        })
        .where(scoped(schema.GlPosting, input.organizationId, posting.id))
    })
    return { ...base, status: 'posted', exportStatus: 'failed', error: reason }
  }
}

/** Bounded recovery also discovers acceptance commits that died before delivery planning. */
export async function sweepAccountingDeliveries(
  db: Database,
  input: { organizationId?: string; limit?: number; timeBudgetMs?: number } = {}
) {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100))
  const postings = await db
    .select({ organizationId: schema.GlPosting.organizationId, glPostingId: schema.GlPosting.id })
    .from(schema.GlPosting)
    .leftJoin(
      schema.AccountingDelivery,
      and(
        eq(schema.AccountingDelivery.organizationId, schema.GlPosting.organizationId),
        eq(schema.AccountingDelivery.glPostingId, schema.GlPosting.id)
      )
    )
    .leftJoin(
      schema.AccountingDeliveryOperation,
      and(
        eq(
          schema.AccountingDeliveryOperation.organizationId,
          schema.AccountingDelivery.organizationId
        ),
        eq(schema.AccountingDeliveryOperation.deliveryId, schema.AccountingDelivery.id),
        eq(schema.AccountingDeliveryOperation.operationKey, 'journal')
      )
    )
    .where(
      and(
        input.organizationId
          ? eq(schema.GlPosting.organizationId, input.organizationId)
          : undefined,
        inArray(schema.GlPosting.deliveryIntent, ['manual', 'automatic']),
        or(
          isNull(schema.AccountingDelivery.id),
          and(
            or(
              eq(schema.GlPosting.deliveryIntent, 'automatic'),
              isNotNull(schema.AccountingDelivery.releasedAt)
            ),
            or(
              isNull(schema.AccountingDeliveryOperation.nextAttemptAt),
              lte(schema.AccountingDeliveryOperation.nextAttemptAt, new Date())
            ),
            or(
              isNull(schema.AccountingDeliveryOperation.leaseExpiresAt),
              lte(schema.AccountingDeliveryOperation.leaseExpiresAt, new Date())
            ),
            inArray(schema.AccountingDeliveryOperation.state, [
              'pending',
              'prepared',
              'sending',
              'uncertain',
              'blocked',
            ])
          )
        )
      )
    )
    .orderBy(
      sql`${schema.AccountingDeliveryOperation.nextAttemptAt} ASC NULLS FIRST`,
      asc(schema.GlPosting.createdAt)
    )
    .limit(limit)
  const results = []
  const deadline = Date.now() + Math.max(1, input.timeBudgetMs ?? 30_000)
  for (const posting of postings) {
    if (Date.now() >= deadline) break
    try {
      results.push(await deliverAccountingPosting(db, posting))
    } catch (error) {
      results.push({ glPostingId: posting.glPostingId, error: message(error) })
    }
  }
  return { examined: results.length, results }
}

async function saveCustomerSuccess(
  db: Database,
  operation: AccountingDeliveryOperationEntity,
  bookId: string,
  remote: Record<string, unknown>
) {
  if (!remote.customerId) throw new Error('QuickBooks customer response has no identity')
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, operation.organizationId)
    const [current] = await tx
      .select()
      .from(schema.AccountingDeliveryOperation)
      .where(scoped(schema.AccountingDeliveryOperation, operation.organizationId, operation.id))
      .limit(1)
    if (current?.state === 'succeeded') return
    await tx.insert(schema.ExternalAccountingObject).values({
      organizationId: operation.organizationId,
      bookId,
      operationId: operation.id,
      objectType: 'customer',
      externalId: String(remote.customerId),
      author: 'auxx',
      remoteVersion: typeof remote.syncToken === 'string' ? remote.syncToken : null,
      remoteBasis: remote,
      componentCoverage: [],
    })
    await tx
      .update(schema.AccountingDeliveryOperation)
      .set({ state: 'succeeded', outcome: remote, failureReason: null })
      .where(scoped(schema.AccountingDeliveryOperation, operation.organizationId, operation.id))
  })
}

async function recoverCustomerDependencies(
  db: Database,
  journal: AccountingDeliveryOperationEntity,
  bookId: string,
  ctx: QuickbooksToolContext
) {
  const pending = await db
    .select()
    .from(schema.AccountingDeliveryOperation)
    .where(
      and(
        eq(schema.AccountingDeliveryOperation.organizationId, journal.organizationId),
        eq(schema.AccountingDeliveryOperation.deliveryId, journal.deliveryId),
        eq(schema.AccountingDeliveryOperation.objectType, 'customer'),
        inArray(schema.AccountingDeliveryOperation.state, ['sending', 'uncertain'])
      )
    )
  for (const operation of pending) {
    if (!operation.payload || accountingBasisHash(operation.payload) !== operation.payloadHash)
      throw new Error('Saved customer dependency payload is invalid')
    const result = await ctx.callTool('find_quickbooks_customer', {
      displayName: operation.payload.displayName,
    })
    const customer = result?.customer
    if (
      !result?.found ||
      !customer?.customerId ||
      customer.notes !== operation.payload.notes ||
      customer.displayName !== operation.payload.displayName ||
      (operation.payload.email &&
        String(customer.email ?? '').toLowerCase() !==
          String(operation.payload.email).toLowerCase())
    ) {
      throw new Error(
        'Customer create has an unknown or conflicting remote outcome; no second create is permitted'
      )
    }
    await saveCustomerSuccess(db, operation, bookId, customer)
  }
}

async function createCustomerDependency(
  db: Database,
  input: {
    operation: AccountingDeliveryOperationEntity
    token: string
    bookId: string
    ctx: QuickbooksToolContext
    values: Record<string, unknown>
  }
) {
  requireInput(input.ctx, 'create_quickbooks_customer', 'requestId')
  const { operation: journal, values } = input
  const operationKey = `customer:${accountingBasisHash({ notes: values.notes, displayName: values.displayName })}`
  const dependency = await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, journal.organizationId)
    const [owner] = await tx
      .select({ id: schema.AccountingDeliveryOperation.id })
      .from(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.id, journal.id),
          eq(schema.AccountingDeliveryOperation.organizationId, journal.organizationId),
          eq(schema.AccountingDeliveryOperation.leaseToken, input.token)
        )
      )
      .limit(1)
    if (!owner) throw new Error('Journal delivery lease was lost')
    const [existing] = await tx
      .select()
      .from(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, journal.organizationId),
          eq(schema.AccountingDeliveryOperation.deliveryId, journal.deliveryId),
          eq(schema.AccountingDeliveryOperation.operationKey, operationKey)
        )
      )
      .limit(1)
    if (existing) return existing
    const requestId = randomUUID()
    const payload = { ...values, requestId }
    const [created] = await tx
      .insert(schema.AccountingDeliveryOperation)
      .values({
        organizationId: journal.organizationId,
        deliveryId: journal.deliveryId,
        operationKey,
        objectType: 'customer',
        requestId,
        payload,
        payloadHash: accountingBasisHash(payload),
        mappingBasis: { companyId: input.ctx.realmId, serverBundleSha: input.ctx.serverBundleSha },
        state: 'prepared',
      })
      .returning()
    if (!created) throw new Error('Customer dependency creation failed')
    return created
  })
  if (dependency.state === 'succeeded') return dependency.outcome
  if (!dependency.payload || accountingBasisHash(dependency.payload) !== dependency.payloadHash)
    throw new Error('Customer dependency payload hash mismatch')
  if (dependency.firstSentAt) throw new Error('Previous customer create has an unresolved outcome')
  const stored = dependency.mappingBasis as { serverBundleSha?: string }
  if (stored.serverBundleSha !== input.ctx.serverBundleSha)
    throw new Error('Customer dependency tool deployment changed')
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, journal.organizationId)
    const [owner] = await tx
      .select({ id: schema.AccountingDeliveryOperation.id })
      .from(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.id, journal.id),
          eq(schema.AccountingDeliveryOperation.organizationId, journal.organizationId),
          eq(schema.AccountingDeliveryOperation.leaseToken, input.token)
        )
      )
      .limit(1)
    if (!owner) throw new Error('Journal delivery lease was lost before dependency send')
    const changed = await tx
      .update(schema.AccountingDeliveryOperation)
      .set({ state: 'sending', firstSentAt: new Date(), attempts: dependency.attempts + 1 })
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, journal.organizationId),
          eq(schema.AccountingDeliveryOperation.id, dependency.id),
          isNull(schema.AccountingDeliveryOperation.firstSentAt)
        )
      )
      .returning({ id: schema.AccountingDeliveryOperation.id })
    if (!changed.length)
      throw new Error('Another worker may already have sent this customer dependency')
  })
  try {
    const remote = await input.ctx.callTool('create_quickbooks_customer', dependency.payload)
    if (
      remote?.notes !== dependency.payload.notes ||
      remote?.displayName !== dependency.payload.displayName
    )
      throw new Error('Created customer does not match the saved dependency')
    await saveCustomerSuccess(db, dependency, input.bookId, remote)
    return remote
  } catch (error) {
    await db
      .update(schema.AccountingDeliveryOperation)
      .set({ state: 'uncertain', failureReason: message(error) })
      .where(scoped(schema.AccountingDeliveryOperation, journal.organizationId, dependency.id))
    throw error
  }
}
