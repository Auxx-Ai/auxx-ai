// packages/lib/src/resources/crud/write-session-als.ts

// Ambient WriteSession propagation (plan 03 §4b S1). Modeled on the proven
// `ruleChain` ALS in record-rules/engine.ts: the handler enters
// `runWithWriteSession(session, ...)` around every public write method, so
// hooks and nested lib calls that construct a fresh UnifiedCrudHandler
// mid-write inherit the parent session (via S1's resolution order) instead of
// silently resetting to interactive.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Database, Transaction } from '@auxx/database'
import type { WriteSession } from './write-origin'

const writeSessionAls = new AsyncLocalStorage<WriteSession>()

/**
 * The CONNECTION of the write in flight, alongside the session. A handler
 * constructed on a transaction runs every public write inside
 * `runWithWriteDb(tx, ...)`, so a hook that builds its own handler, service
 * or field-value context mid-write inherits the transaction instead of
 * grabbing a second pool connection. That second connection is what turned a
 * transaction-scoped create into a 30 s idle-in-transaction timeout: it
 * cannot see the uncommitted rows, and a write on it that conflicts with one
 * of them waits on the very transaction that is waiting for it
 * (plans/field-values/create-path-batching.md section 2b).
 */
const writeDbAls = new AsyncLocalStorage<Database | Transaction>()

/**
 * Run `fn` with `session` as the ambient write session. Nested calls with the
 * same session are harmless; a nested call with a different session shadows
 * the outer one for its own subtree (standard ALS semantics).
 */
export function runWithWriteSession<T>(session: WriteSession, fn: () => T): T {
  return writeSessionAls.run(session, fn)
}

/**
 * The ambient write session of the current async context, or undefined when
 * no write is in flight (e.g. a handler constructed at request setup time).
 */
export function getAmbientWriteSession(): WriteSession | undefined {
  return writeSessionAls.getStore()
}

/** Run `fn` with `db` as the ambient connection of the write in flight. */
export function runWithWriteDb<T>(db: Database | Transaction, fn: () => T): T {
  return writeDbAls.run(db, fn)
}

/**
 * The connection of the write in flight, or undefined outside one. Resolution
 * order for anything that needs a db and was not handed one: explicit
 * argument, then this, then the pool.
 */
export function getAmbientWriteDb(): Database | Transaction | undefined {
  return writeDbAls.getStore()
}
