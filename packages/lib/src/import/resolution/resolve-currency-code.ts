// packages/lib/src/import/resolution/resolve-currency-code.ts

import type { Database, Transaction } from '@auxx/database'
import { findCachedResource } from '../../cache'
import { resolveCurrencyCode } from '../../field-values/converters/currency'
import { getOrgCurrencyCode } from '../../field-values/org-currency'
import { getFieldOutputKey } from '../../resources/registry/field-types'

/** What {@link resolveColumnCurrencyCodes} needs to answer for a whole mapping */
export interface ResolveColumnCurrencyCodesInput {
  organizationId: string
  /** `ImportMapping.entityDefinitionId` — the resource every column targets */
  entityDefinitionId: string
  /** `targetFieldKey` of every column resolved with `currency:*` */
  targetFieldKeys: string[]
}

/**
 * Resolve the ISO 4217 code each `currency:*` column must scale by, keyed by
 * `targetFieldKey`.
 *
 * The chain is the platform's one CURRENCY denomination chain — **field → org →
 * USD** ({@link resolveCurrencyCode}) — not a second copy of it. A field that
 * asserted `options.currencyCode` is pinned to it; the ~213 fields that never
 * picked one follow `organization.currency`.
 *
 * 🛑 Resolved at RUN time, never persisted into the column's stored
 * `resolutionConfig`. A frozen copy would keep scaling an inheriting field by
 * the exponent its org used to have, which is the exact "absent means inherit"
 * collapse `org-currency.ts` warns about — except silently wrong by a factor of
 * 100 instead of merely mis-rendered.
 *
 * Batched deliberately: the org setting and the resource are each read once for
 * the whole mapping, so a 40-column file with six money columns is two cache
 * lookups, not twelve.
 *
 * Returns codes only for keys that resolve to a real field; a caller falls back
 * to leaving `ResolutionConfig.currencyCode` unset, which the resolver reads as
 * USD.
 *
 * @param db - Database instance (for the org-settings read)
 * @param input - Org, target resource, and the money columns' field keys
 * @returns Map of `targetFieldKey` → ISO 4217 code
 */
export async function resolveColumnCurrencyCodes(
  db: Database | Transaction,
  input: ResolveColumnCurrencyCodesInput
): Promise<Map<string, string>> {
  const codes = new Map<string, string>()
  if (input.targetFieldKeys.length === 0) return codes

  const orgCurrencyCode = await getOrgCurrencyCode(input.organizationId, db)
  const resource = await findCachedResource(input.organizationId, input.entityDefinitionId)

  const wanted = new Set(input.targetFieldKeys)
  for (const field of resource?.fields ?? []) {
    const key = getFieldOutputKey(field)
    if (!wanted.has(key)) continue
    codes.set(key, resolveCurrencyCode(field.options?.currencyCode, orgCurrencyCode))
  }

  // A column whose field vanished from the registry still gets the org rung —
  // better a right-for-the-org exponent than a hardcoded 2.
  for (const key of wanted) {
    if (!codes.has(key)) codes.set(key, resolveCurrencyCode(undefined, orgCurrencyCode))
  }

  return codes
}
