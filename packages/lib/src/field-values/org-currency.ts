// packages/lib/src/field-values/org-currency.ts

import type { Database, Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { FieldOptions } from '../custom-fields/field-options'
import { getOrganizationSetting } from '../settings'
import { resolveCurrencyCode } from './converters/currency'

/**
 * The org rung of the CURRENCY denomination chain: **field → org → USD**.
 *
 * A CURRENCY field that never picked a `currencyCode` inherits the org's, so
 * one setting at `/app/dispatch/settings/general` moves every such field at
 * once — in the table, the drawer, CSV, PDF, placeholders and search text
 * alike. A field that DID pick one is pinned and ignores the setting.
 *
 * 🛑 The resolved code is never written back to `field.options`. Stamping it —
 * in a cache, in a default, or via an editor that pre-fills the picker and then
 * saves — makes an inherited code indistinguishable from an asserted one, and
 * the field stops following the setting forever. Absent means inherit, and it
 * has to stay absent.
 */

/**
 * Read the org's currency code once, for a whole batch of display formatting.
 *
 * Backed by the `orgSettings` org-cache key, so this is a map lookup rather than
 * a query — but it is still `async`, so resolve it ONCE per batch and hand the
 * string down, never per field value inside a loop.
 */
export async function getOrgCurrencyCode(
  organizationId: string,
  db?: Database | Transaction
): Promise<string> {
  const value = await getOrganizationSetting({
    key: 'organization.currency',
    organizationId,
    db,
  })
  return resolveCurrencyCode(undefined, value)
}

/**
 * Layer the org rung under a CURRENCY field's options for one format call.
 *
 * A no-op for every other field type, so display paths can wrap unconditionally
 * instead of branching on `fieldType` at each call site.
 */
export function withOrgCurrency(
  options: FieldOptions | null | undefined,
  fieldType: FieldType | string | null | undefined,
  orgCurrencyCode: string | undefined
): FieldOptions | undefined {
  if (fieldType !== 'CURRENCY') return options ?? undefined
  return {
    ...(options ?? {}),
    currencyCode: resolveCurrencyCode(options?.currencyCode, orgCurrencyCode),
  }
}
