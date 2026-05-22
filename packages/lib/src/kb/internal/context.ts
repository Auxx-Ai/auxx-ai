// @auxx/lib/kb/internal/context.ts
import { type Database, database, type Transaction } from '@auxx/database'
import type { KBContext } from '../types'

/**
 * Resolve the active db handle for a kb function call. Falls back to the
 * singleton `database` export when the caller didn't pass one.
 */
export function resolveDb(ctx: KBContext): Database | Transaction {
  return ctx.db ?? database
}
