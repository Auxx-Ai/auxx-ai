// packages/lib/src/money/credit-memos/command.ts

import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ConflictError } from '../../errors'
import { accountingBasisHash } from '../../postings/effect-basis'
import { flushTxWriteScope } from '../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../resources/crud/tx-write-scope'
import { runWithWriteDb } from '../../resources/crud/write-session-als'
import { runWithCreditApplicationWrite } from './write-scope'

/** Serialize credit consumption and save its result with the ordinary record writes. */
export async function runCreditCommand<T extends Record<string, string>>(
  db: Database,
  input: {
    organizationId: string
    userId: string
    commandKey: string
    kind: string
    payload: unknown
  },
  execute: (tx: Transaction) => Promise<T>
): Promise<T> {
  if (!input.commandKey?.trim() || input.commandKey.length > 200)
    throw new BadRequestError('A credit command needs a retry key of at most 200 characters')
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
            throw new ConflictError('This credit retry key already belongs to a different request')
          return previous.resultIds as T
        }
        const result = await runWithCreditApplicationWrite(() => execute(tx))
        await tx.insert(schema.MoneyCommand).values({
          organizationId: input.organizationId,
          commandKey: input.commandKey,
          kind: input.kind,
          payloadHash,
          actorSnapshot: { userId: input.userId },
          resultIds: result,
        })
        return result
      })
    )
  )
  if (committed.owned) await flushTxWriteScope(committed.scope)
  return committed.result
}
