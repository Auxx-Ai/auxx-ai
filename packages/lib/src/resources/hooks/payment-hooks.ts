// packages/lib/src/resources/hooks/payment-hooks.ts

import { BadRequestError } from '../../errors'
import type { SystemHook, SystemHookRegistry } from './types'

const PROVENANCE_ERROR = "Payments are recorded through the invoice's Record payment action"
const MIRROR_READONLY_ERROR =
  'Payment records are read-only — delete this payment and record it again to correct a mistake'

/**
 * Provenance gate (money MI1 build spec §F.3): on create, reject any payment that doesn't
 * carry a ledger-stamped `payment_transaction_id`. SystemHooks fire on the
 * `UnifiedCrudHandler` path (unified-handler.ts:1204-1257) — exactly the path the generic
 * dialog, Kopilot record tools, and imports use — so the ledger's own `handler.create` (which
 * always passes the id, `packages/lib/src/money/payments/ledger.ts`) is the only call that gets
 * through, without any bypass machinery.
 */
const requireLedgerProvenance: SystemHook = async ({ operation, field, values }) => {
  if (operation !== 'create') return values
  // Incoming values may be keyed by fieldId or systemAttribute, scalar or single-element array.
  const raw = field.id in values ? values[field.id] : values[field.systemAttribute ?? '']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) {
    throw new BadRequestError(PROVENANCE_ERROR)
  }
  return values
}

/**
 * Payment mirror fields are read-only once created — the ledger (`syncTransaction` /
 * `deleteManualPayment`) is the sole writer for `amount`/`invoice`/`transactionId`.
 * Corrections are delete + re-record (decision 3), never an in-place edit.
 */
const rejectMirrorFieldUpdate: SystemHook = async ({ operation, values }) => {
  if (operation === 'update') {
    throw new BadRequestError(MIRROR_READONLY_ERROR)
  }
  return values
}

export const PAYMENT_HOOKS: SystemHookRegistry = {
  payment_transaction_id: [requireLedgerProvenance, rejectMirrorFieldUpdate],
  payment_amount: [rejectMirrorFieldUpdate],
  payment_invoice: [rejectMirrorFieldUpdate],
}
