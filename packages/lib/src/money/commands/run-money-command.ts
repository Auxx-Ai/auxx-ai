// packages/lib/src/money/commands/run-money-command.ts

import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ConflictError } from '../../errors'
import { accountingBasisHash } from '../../postings/basis-hash'
import { flushTxWriteScope } from '../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../resources/crud/tx-write-scope'
import { runWithWriteDb } from '../../resources/crud/write-session-als'

/** Longest accepted `MoneyCommand.commandKey`; the column is unbounded, callers are not. */
const MAX_COMMAND_KEY_LENGTH = 200

export interface MoneyCommandInput {
  organizationId: string
  userId: string
  /**
   * The idempotency key. A retry carrying the same key and the same payload
   * returns the first run's `resultIds` without executing again; the same key
   * with a different payload is a 409, because two different requests wearing
   * one key is a caller bug, not a retry.
   */
  commandKey: string
  /** Command family, e.g. `record_manual_payment`. Part of the conflict check. */
  kind: string
  /** Anything hashable. Only its hash is stored. */
  payload: unknown
  /**
   * Extra facts merged into `actorSnapshot`. The only durable link a document
   * with no `MoneyApplication` column has - a held quote deposit is found by
   * `actorSnapshot->>'quoteInstanceId'`.
   */
  actorContext?: Record<string, string>
}

export interface MoneyCommandOptions {
  /**
   * An AsyncLocalStorage wrapper the module uses to prove to its own write
   * guards that a validated command owns the write — `runWithCreditApplicationWrite`
   * is the precedent. Omit it when the module has no such guard.
   */
  scope?: <T>(work: () => Promise<T>) => Promise<T>
}

/**
 * Run one money-moving command exactly once, inside the accounting commit lock.
 *
 * This is the single write door for `MoneyTransaction` / `MoneyApplication` and
 * everything that hangs off them. It was extracted verbatim from
 * `credit-memos/command.ts`'s `runCreditCommand`, which had been the de-facto
 * runner for non-credit work for some time — the legacy payments lane called it
 * for refunds too — while its name and its error strings claimed otherwise.
 *
 * ## 🔑 Why the command row exists at all
 *
 * `MoneyTransaction` has no natural idempotency key. Two identical $170 receipts
 * for one customer on one day are a legitimate pair, so the rows cannot dedupe
 * themselves. `MoneyCommand` carries the key the CALLER knows — a Stripe event
 * id, a checkout session, a request id — and every row written under it points
 * back via `recordedByCommandId` / `commandId`. That is also what makes a
 * partially-applied retry safe: the second run returns the first run's
 * `resultIds` rather than writing a second transaction.
 *
 * ## ⚠️ The lock is taken before the read
 *
 * `withAccountingCommitLock` comes first so the existence check and the insert
 * cannot interleave with another command for the same org. Without it two
 * concurrent retries of one key both miss, both insert, and the unique index
 * turns a retry into a 500.
 *
 * @param execute Runs inside the transaction with the new command's id. Its
 *   return value is persisted to `resultIds` and replayed verbatim on retry, so
 *   it must be a flat map of ids — not entities, not anything with a `Date`.
 */
export async function runMoneyCommand<T extends Record<string, string>>(
  db: Database,
  input: MoneyCommandInput,
  execute: (tx: Transaction, commandId: string) => Promise<T>,
  options: MoneyCommandOptions = {}
): Promise<T> {
  if (!input.commandKey?.trim() || input.commandKey.length > MAX_COMMAND_KEY_LENGTH)
    throw new BadRequestError(
      `A money command needs a retry key of at most ${MAX_COMMAND_KEY_LENGTH} characters`
    )
  const payloadHash = accountingBasisHash({ kind: input.kind, payload: input.payload })
  const committed = await db.transaction((tx) =>
    runInTxWrite({ organizationId: input.organizationId, actorUserId: input.userId }, () =>
      runWithWriteDb(tx, async () => {
        await withAccountingCommitLock(tx, input.organizationId)
        const previous = await tx.query.MoneyCommand.findFirst({
          where: and(
            eq(schema.MoneyCommand.organizationId, input.organizationId),
            eq(schema.MoneyCommand.commandKey, input.commandKey)
          ),
        })
        if (previous) {
          if (previous.payloadHash !== payloadHash || previous.kind !== input.kind)
            throw new ConflictError('This retry key already belongs to a different request')
          return previous.resultIds as T
        }
        const [command] = await tx
          .insert(schema.MoneyCommand)
          .values({
            organizationId: input.organizationId,
            commandKey: input.commandKey,
            kind: input.kind,
            payloadHash,
            actorSnapshot: { userId: input.userId, ...input.actorContext },
          })
          .returning({ id: schema.MoneyCommand.id })
        if (!command) throw new Error('Money command insert returned no row')
        const run = () => execute(tx, command.id)
        const result = options.scope ? await options.scope(run) : await run()
        await tx
          .update(schema.MoneyCommand)
          .set({ resultIds: result })
          .where(
            and(
              eq(schema.MoneyCommand.organizationId, input.organizationId),
              eq(schema.MoneyCommand.id, command.id)
            )
          )
        return result
      })
    )
  )
  if (committed.owned) await flushTxWriteScope(committed.scope)
  return committed.result
}
