// packages/lib/src/accounting/export/send-many.ts
// Lease a set of batches at once, send them in as few provider calls as the
// provider allows, and settle each row exactly as `send.ts` does (plan 93 §5 D4).

import { type Database, type ExportBatchEntity, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ProviderPostError } from '../ledger/types'
import {
  type AccountingProvider,
  type ProviderObjectContext,
  resolveAccountingProvider,
  type SendObjectResult,
} from '../providers/provider'
import { PAYMENT_OBJECT_TYPE } from './payloads/payment'
import { readExportBatchBlockers } from './preflight'
import { readLiveBatchMemberships } from './queue-reads'
import {
  fail,
  type HeldBatch,
  leaseBatches,
  preflightRefusal,
  type SendExportBatchResult,
  sendInputFor,
  settleSend,
} from './send'

const logger = createScopedLogger('postings:export-send-many')

/**
 * Most batches one `export-batches` job carries. The whole set rides one Lambda call
 * (30s cap) and Intuit runs batch items one after another, so it sits well under 30.
 */
export const EXPORT_BATCHES_PER_JOB = 10

export interface SendExportBatchesResult {
  /** One per batch this call leased, in the order they settled. */
  results: SendExportBatchResult[]
  /** Asked for but not leased: gone, already sent or withdrawn, or held by another worker. */
  notLeased: string[]
}

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

/** Document date, then creation - the sweep's order, which puts an invoice before its payment. */
function sendOrder(a: HeldBatch, b: HeldBatch): number {
  const dateOf = (held: HeldBatch) => (held.batch.payload as { txnDate?: unknown }).txnDate
  const [left, right] = [dateOf(a), dateOf(b)]
  if (left !== right) {
    if (typeof left !== 'string') return 1
    if (typeof right !== 'string') return -1
    return left < right ? -1 : 1
  }
  return a.batch.createdAt.getTime() - b.batch.createdAt.getTime()
}

interface Dependency {
  /** The batch holding the posting the payment applies to; null when nothing has claimed it. */
  batchId: string | null
  sent: boolean
}

/** Each payment row's `appliesTo` batch and whether it has already sent. */
async function readPaymentDependencies(
  db: Database,
  organizationId: string,
  batches: readonly ExportBatchEntity[]
): Promise<Map<string, Dependency>> {
  const postingOf = new Map<string, string>()
  for (const batch of batches) {
    if (batch.objectType !== PAYMENT_OBJECT_TYPE) continue
    const glPostingId = (batch.payload as { appliesTo?: { glPostingId?: unknown } }).appliesTo
      ?.glPostingId
    if (typeof glPostingId === 'string') postingOf.set(batch.id, glPostingId)
  }
  const dependencies = new Map<string, Dependency>()
  for (const batch of batches)
    if (batch.objectType === PAYMENT_OBJECT_TYPE)
      dependencies.set(batch.id, { batchId: null, sent: false })
  if (postingOf.size === 0) return dependencies

  const members = await readLiveBatchMemberships(db, organizationId, {
    glPostingIds: [...postingOf.values()],
  })
  const batchOfPosting = new Map(members.map((member) => [member.glPostingId, member.batchId]))
  const dependencyIds = [...new Set(members.map((member) => member.batchId))]
  const states =
    dependencyIds.length === 0
      ? []
      : await db
          .select({ id: schema.ExportBatch.id, state: schema.ExportBatch.state })
          .from(schema.ExportBatch)
          .where(
            and(
              eq(schema.ExportBatch.organizationId, organizationId),
              inArray(schema.ExportBatch.id, dependencyIds)
            )
          )
  const sentIds = new Set(states.filter((row) => row.state === 'sent').map((row) => row.id))
  for (const [paymentId, glPostingId] of postingOf) {
    const batchId = batchOfPosting.get(glPostingId) ?? null
    dependencies.set(paymentId, { batchId, sent: batchId !== null && sentIds.has(batchId) })
  }
  return dependencies
}

/** Move a payment behind its dependency when both are in this job, so the order never sends it first. */
function dependenciesFirst(
  rows: readonly HeldBatch[],
  dependencies: ReadonlyMap<string, Dependency>
): HeldBatch[] {
  const inJob = new Set(rows.map((row) => row.batch.id))
  const placed = new Set<string>()
  const deferred = new Map<string, HeldBatch[]>()
  const ordered: HeldBatch[] = []
  const place = (row: HeldBatch) => {
    ordered.push(row)
    placed.add(row.batch.id)
    for (const next of deferred.get(row.batch.id) ?? []) place(next)
    deferred.delete(row.batch.id)
  }
  for (const row of rows) {
    const on = dependencies.get(row.batch.id)?.batchId
    if (on && on !== row.batch.id && inJob.has(on) && !placed.has(on)) {
      deferred.set(on, [...(deferred.get(on) ?? []), row])
      continue
    }
    place(row)
  }
  return ordered
}

/** One provider call's answers, aligned with `group`; a provider without `sendObjects` is asked row by row. */
async function sendGroup(
  provider: AccountingProvider,
  ctx: ProviderObjectContext,
  group: readonly HeldBatch[]
): Promise<Result<SendObjectResult, Error>[]> {
  const inputs = group.map((held) => sendInputFor(held.batch, provider))
  if (!provider.sendObjects) {
    const answers: Result<SendObjectResult, Error>[] = []
    for (const input of inputs)
      answers.push(await provider.sendObject(ctx, input).catch((error) => err(asError(error))))
    return answers
  }
  const answered = await provider
    .sendObjects(ctx, inputs)
    .catch((error) => err<Result<SendObjectResult, Error>[], Error>(asError(error)))
  // The whole call went unanswered: every row fails on that one error and its own backoff.
  if (answered.isErr()) return inputs.map(() => err(answered.error))
  return inputs.map(
    (_, index) =>
      answered.value[index] ??
      err(
        new ProviderPostError('The provider returned no answer for this object.', {
          failureClass: 'transport',
          providerId: provider.id,
        })
      )
  )
}

/**
 * Send a set of batches.
 *
 * Never throws; every leased row ends settled, as {@link sendExportBatch} would leave
 * it. A set handed to one provider call never holds a payment together with an
 * unsent batch it applies to: the walk cuts there, settles, and carries on.
 */
export async function sendExportBatches(
  db: Database,
  input: { organizationId: string; batchIds: string[]; runId?: string; manual?: boolean }
): Promise<Result<SendExportBatchesResult, Error>> {
  const { organizationId } = input
  const batchIds = [...new Set(input.batchIds)]
  let held: HeldBatch[]
  try {
    held = await leaseBatches(db, {
      organizationId,
      batchIds,
      manual: input.manual === true,
      ...(input.runId ? { runId: input.runId } : {}),
    })
  } catch (error) {
    return err(asError(error))
  }
  const won = new Set(held.map((row) => row.batch.id))
  const notLeased = batchIds.filter((id) => !won.has(id))

  const results: SendExportBatchResult[] = []
  const unsettled = new Map(held.map((row) => [row.batch.id, row]))
  const sentInJob = new Set<string>()
  const settle = async (row: HeldBatch, run: () => Promise<SendExportBatchResult>) => {
    unsettled.delete(row.batch.id)
    let result: SendExportBatchResult
    try {
      result = await run()
    } catch (error) {
      result = await fail(db, row.batch, row.token, asError(error))
    }
    if (result.status === 'sent') sentInJob.add(row.batch.id)
    results.push(result)
  }

  try {
    const provider = await resolveAccountingProvider(organizationId)

    const blocked = await readExportBatchBlockers(
      db,
      organizationId,
      held.map((row) => ({ id: row.batch.id, payload: row.batch.payload }))
    )
    if (blocked.isErr()) {
      for (const row of held) await settle(row, () => fail(db, row.batch, row.token, blocked.error))
      return ok({ results, notLeased })
    }
    const sendable: HeldBatch[] = []
    for (const row of held) {
      const blockers = blocked.value.get(row.batch.id)
      if (blockers && blockers.length > 0)
        await settle(row, () =>
          fail(db, row.batch, row.token, preflightRefusal(blockers, provider.id))
        )
      else sendable.push(row)
    }

    const dependencies = await readPaymentDependencies(
      db,
      organizationId,
      sendable.map((row) => row.batch)
    )
    const waitsOnUnsent = (row: HeldBatch) => {
      const dependency = dependencies.get(row.batch.id)
      if (!dependency) return false
      return !dependency.sent && !(dependency.batchId && sentInJob.has(dependency.batchId))
    }

    let rest = dependenciesFirst([...sendable].sort(sendOrder), dependencies)
    while (rest.length > 0) {
      // A payment whose invoice has not sent goes alone, and the provider answers it `waiting`.
      const set: HeldBatch[] = []
      for (const row of rest) {
        if (waitsOnUnsent(row)) {
          if (set.length === 0) set.push(row)
          break
        }
        set.push(row)
      }
      rest = rest.slice(set.length)

      const byConnection = new Map<string, HeldBatch[]>()
      for (const row of set)
        byConnection.set(row.batch.connectionId, [
          ...(byConnection.get(row.batch.connectionId) ?? []),
          row,
        ])
      for (const [connectionId, group] of byConnection) {
        const ctx: ProviderObjectContext = { organizationId, connectionId }
        const answers = await sendGroup(provider, ctx, group)
        for (const [index, row] of group.entries())
          await settle(row, () =>
            settleSend(db, row, provider, ctx, answers[index] as Result<SendObjectResult, Error>)
          )
      }
    }
  } catch (error) {
    for (const row of [...unsettled.values()])
      await settle(row, () => fail(db, row.batch, row.token, asError(error)))
  }

  logger.info('Export batch set settled', {
    organizationId,
    leased: held.length,
    notLeased: notLeased.length,
    sent: results.filter((result) => result.status === 'sent').length,
    failed: results.filter((result) => result.status === 'failed').length,
  })
  return ok({ results, notLeased })
}
