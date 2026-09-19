// packages/lib/src/accounting/sales/credit-memos/command.ts

import type { Database, Transaction } from '@auxx/database'
import { type MoneyCommandInput, runMoneyCommand } from '../../money/commands/run-money-command'
import { runWithCreditApplicationWrite } from './write-scope'

/**
 * Serialize credit consumption and save its result with the ordinary record writes.
 *
 * A thin binding of {@link runMoneyCommand} to the credit-application write
 * scope. The runner's body used to live here; it moved to `money/commands/`
 * once it became clear the payments lane was already calling it for work that
 * had nothing to do with credit. Everything about idempotency, the commit lock
 * and the `resultIds` replay is documented there.
 *
 * 🔑 The one thing this wrapper adds is {@link runWithCreditApplicationWrite},
 * which is how `isCreditApplicationWrite()` proves to the credit write guards
 * that a validated command — not a stray caller — owns the current write.
 */
export async function runCreditCommand<T extends Record<string, string>>(
  db: Database,
  input: MoneyCommandInput,
  execute: (tx: Transaction, commandId: string) => Promise<T>
): Promise<T> {
  return runMoneyCommand(db, input, execute, { scope: runWithCreditApplicationWrite })
}
