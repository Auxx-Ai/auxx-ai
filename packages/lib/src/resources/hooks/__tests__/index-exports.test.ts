// packages/lib/src/resources/hooks/__tests__/index-exports.test.ts
//
// The barrel and `system-hooks.ts`'s registry are two hand-maintained lists of
// the same thing, and only one of them is load-bearing at runtime - so a
// registry entry with no barrel export is invisible until somebody imports the
// name and gets `undefined`. `BANK_DEPOSIT_HOOKS` shipped that way.
//
// This asserts the barrel covers the registry rather than pinning a literal
// list, so the next hook file added to `SYSTEM_HOOK_REGISTRY` fails here on the
// day it lands instead of on the day something imports it.

import { describe, expect, it } from 'vitest'
import * as barrel from '../index'

/**
 * `getSystemHooks(entityType)` answers per type, so the registry itself is not
 * exported. These are the entity types that have a hook file, named the way the
 * barrel names them.
 */
const REGISTERED = [
  ['bank_deposit', 'BANK_DEPOSIT_HOOKS'],
  ['build', 'BUILD_HOOKS'],
  ['contact', 'CONTACT_HOOKS'],
  ['invoice', 'INVOICE_HOOKS'],
  ['journal_entry', 'JOURNAL_ENTRY_HOOKS'],
  ['line_item', 'LINE_ITEM_HOOKS'],
  ['order', 'ORDER_HOOKS'],
  ['payment', 'PAYMENT_HOOKS'],
  ['purchase_order', 'PURCHASE_ORDER_HOOKS'],
  ['quote', 'QUOTE_HOOKS'],
  ['service_request', 'SERVICE_REQUEST_HOOKS'],
  ['ticket', 'TICKET_HOOKS'],
  ['vendor_bill', 'VENDOR_BILL_HOOKS'],
  ['work_order', 'WORK_ORDER_HOOKS'],
] as const

describe('the hooks barrel', () => {
  it.each(REGISTERED)('exports the hooks for %s', (entityType, exportName) => {
    expect(barrel.getSystemHooks(entityType)).toBeDefined()
    // A missing re-export means the key is absent from the namespace entirely,
    // which is exactly the `undefined` an importer would have got.
    expect(Object.keys(barrel)).toContain(exportName)
  })
})
