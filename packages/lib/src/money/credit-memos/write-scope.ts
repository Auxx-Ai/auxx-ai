// packages/lib/src/money/credit-memos/write-scope.ts
import { AsyncLocalStorage } from 'node:async_hooks'

const writes = new AsyncLocalStorage<boolean>()
/** Restrict credit application writes to validated commands. */
export function runWithCreditApplicationWrite<T>(work: () => T): T {
  return writes.run(true, work)
}
/** Whether a validated credit command owns the current application write. */
export function isCreditApplicationWrite(): boolean {
  return writes.getStore() === true
}
