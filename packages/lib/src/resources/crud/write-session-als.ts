// packages/lib/src/resources/crud/write-session-als.ts

// Ambient WriteSession propagation (plan 03 §4b S1). Modeled on the proven
// `ruleChain` ALS in record-rules/engine.ts: the handler enters
// `runWithWriteSession(session, ...)` around every public write method, so
// hooks and nested lib calls that construct a fresh UnifiedCrudHandler
// mid-write inherit the parent session (via S1's resolution order) instead of
// silently resetting to interactive.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { WriteSession } from './write-origin'

const writeSessionAls = new AsyncLocalStorage<WriteSession>()

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
