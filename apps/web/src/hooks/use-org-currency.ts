// apps/web/src/hooks/use-org-currency.ts
'use client'

import { normalizeCurrencyCode } from '@auxx/lib/field-values/client'
import { useDehydratedSettingsOptional } from '~/providers/dehydrated-state-provider'

/**
 * The organization's ISO 4217 currency code — the middle rung of a CURRENCY
 * field's denomination chain: **field → org → USD**.
 *
 * A CURRENCY field that never picked its own `currencyCode` renders in this
 * one, so changing it at `/app/dispatch/settings/general` moves every such
 * field at once. A field that DID pick one ignores it.
 *
 * 🛑 Never write the result back into `field.options.currencyCode`. An absent
 * field code means INHERIT, and it has to stay absent — stamping the resolved
 * code (including by pre-filling a picker that then saves) pins the field and
 * it stops following the setting forever.
 *
 * Reads the dehydrated settings already hydrated on page load — no fetch, no
 * suspense, no loading state. `getAllUserSettings` seeds every catalog key with
 * its `defaultValue` before overlaying org rows, so this is `'USD'` for an org
 * that has never touched the setting rather than undefined.
 *
 * Falls back to `'USD'` outside a `DehydratedStateProvider` (tests, isolated
 * previews) rather than throwing — a money cell should render, not crash the
 * tree, when there is no org in scope.
 */
export function useOrgCurrency(): string {
  const settings = useDehydratedSettingsOptional()
  return normalizeCurrencyCode(settings?.['organization.currency']) ?? 'USD'
}
