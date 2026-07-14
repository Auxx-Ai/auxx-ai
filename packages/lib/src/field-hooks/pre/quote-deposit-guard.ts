// packages/lib/src/field-hooks/pre/quote-deposit-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import type { FieldPreHookHandler } from '../types'

/**
 * The return-to-draft wall for `quote_status` (money MP2 build spec §B.10). The system-hook
 * chain's `rejectManualLifecycleStatus` (`resources/hooks/quote-hooks.ts`) is dead for real
 * client writes to this field — the generic records path (form edits, Kopilot record tools)
 * runs `fireFieldPreHooks` (this **field**-pre-hook chain), never
 * `UnifiedCrudHandler.runPreHooks` (the **system**-hook chain). So this guard, not that one, is
 * the actual enforcement point.
 *
 * Rejects a manual `quote_status → 'draft'` write when a succeeded deposit charge is already
 * held against the quote — editing a paid quote back to draft would orphan the deposit with no
 * document to reconcile it against.
 */
export const guardQuoteDraftReturnWithPaidDeposit: FieldPreHookHandler = async (event) => {
  // SINGLE_SELECT values can arrive array-wrapped (`['draft']`) or as a bare scalar — normalize
  // before comparing, matching the `Array.isArray(raw) ? raw[0] : raw` idiom used elsewhere for
  // status fields (e.g. `resources/hooks/quote-hooks.ts`'s `rejectManualLifecycleStatus`).
  const next = Array.isArray(event.newValue) ? event.newValue[0] : event.newValue
  if (next !== 'draft') return event.newValue

  const quoteInstanceId = parseRecordId(event.recordId).entityInstanceId
  const deposit = await database.query.PaymentTransaction.findFirst({
    where: and(
      eq(schema.PaymentTransaction.organizationId, event.organizationId),
      eq(schema.PaymentTransaction.quoteInstanceId, quoteInstanceId),
      eq(schema.PaymentTransaction.kind, 'charge'),
      eq(schema.PaymentTransaction.status, 'succeeded')
    ),
    columns: { id: true },
  })
  if (deposit) {
    throw new BadRequestError(
      'Cannot return this quote to draft — a deposit has been paid against it.'
    )
  }

  return event.newValue
}
