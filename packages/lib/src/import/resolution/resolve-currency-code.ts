// packages/lib/src/import/resolution/resolve-currency-code.ts

import type { Database, Transaction } from '@auxx/database'
import { findCachedResource } from '../../cache'
import { resolveCurrencyCode } from '../../field-values/converters/currency'
import { getOrgCurrencyCode } from '../../field-values/org-currency'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import { BaseType } from '../../resources/types'

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

/** What {@link resolveColumnDecimals} needs to answer for a whole mapping */
export interface ResolveColumnDecimalsInput {
  organizationId: string
  /** `ImportMapping.entityDefinitionId`: the resource every column targets */
  entityDefinitionId: string
  /** `targetFieldKey` of every column resolved with `currency:*` */
  targetFieldKeys: string[]
}

/**
 * Resolve each `currency:*` column's field-declared major-unit precision
 * (`options.decimals`), keyed by `targetFieldKey`. Companion to
 * {@link resolveColumnCurrencyCodes}: the currency decides the EXPONENT, the
 * field decides the PLACES. A rate field (`decimals: RATE_DECIMALS`) admits
 * five; a plain amount field admits none beyond the exponent.
 *
 * 🛑 Resolved at RUN time, never persisted into the column's stored
 * `resolutionConfig`, for the same reason `resolveColumnCurrencyCodes` is not:
 * a field's precision can widen after a mapping was made (migration 121), and
 * a frozen copy would keep refusing the extra places forever.
 *
 * A column whose key is absent from the returned map gets no `decimals`;
 * `currency:major` then caps at the currency's exponent exactly as it always
 * has.
 *
 * @param db - Database instance (unused today; symmetric with
 *   `resolveColumnCurrencyCodes` and kept for the same future-proofing)
 * @param input - Org, target resource, and the money columns' field keys
 * @returns Map of `targetFieldKey` → `options.decimals`
 */
export async function resolveColumnDecimals(
  db: Database | Transaction,
  input: ResolveColumnDecimalsInput
): Promise<Map<string, number>> {
  const decimals = new Map<string, number>()
  if (input.targetFieldKeys.length === 0) return decimals

  const resource = await findCachedResource(input.organizationId, input.entityDefinitionId)

  const wanted = new Set(input.targetFieldKeys)
  for (const field of resource?.fields ?? []) {
    const key = getFieldOutputKey(field)
    if (!wanted.has(key)) continue
    const value = field.options?.decimals
    if (typeof value === 'number') decimals.set(key, value)
  }

  return decimals
}

/** What {@link resolveColumnCurrencyFields} needs to answer for a set of columns */
export interface ResolveColumnCurrencyFieldsInput {
  organizationId: string
  /** `ImportMapping.entityDefinitionId` — the resource every column targets */
  entityDefinitionId: string
  /** `targetFieldKey` of the columns to check; non-money keys are simply absent from the answer */
  targetFieldKeys: string[]
}

/** How a CURRENCY target field denominates and displays its minor units. */
export interface ColumnCurrencyField {
  /** ISO 4217 code, resolved through the field → org → USD chain */
  currencyCode: string
  /** The field's declared major-unit precision (`options.decimals`), when it declares one */
  decimals?: number
}

/**
 * The currency code and precision of every column whose TARGET FIELD is a
 * CURRENCY field, whatever resolution type the column uses.
 *
 * The two helpers above are keyed on the column being read with `currency:*`.
 * This one is keyed on the FIELD, because the review and confirm steps need to
 * show a resolved minor-unit number as money regardless of how it was read: a
 * `number:integer` column feeding Unit Price still resolves to cents, and a
 * bare `1594` beside `$15.94` in the file reads as a hundredfold error.
 *
 * @param db - Database instance (for the org-settings read)
 * @param input - Org, target resource and the column keys to look up
 * @returns Map of `targetFieldKey` → code and precision, CURRENCY fields only
 */
export async function resolveColumnCurrencyFields(
  db: Database | Transaction,
  input: ResolveColumnCurrencyFieldsInput
): Promise<Map<string, ColumnCurrencyField>> {
  const result = new Map<string, ColumnCurrencyField>()
  if (input.targetFieldKeys.length === 0) return result

  const resource = await findCachedResource(input.organizationId, input.entityDefinitionId)
  const wanted = new Set(input.targetFieldKeys)
  const moneyFields = (resource?.fields ?? []).filter(
    (field) => field.type === BaseType.CURRENCY && wanted.has(getFieldOutputKey(field))
  )
  if (moneyFields.length === 0) return result

  const orgCurrencyCode = await getOrgCurrencyCode(input.organizationId, db)
  for (const field of moneyFields) {
    const decimals = field.options?.decimals
    result.set(getFieldOutputKey(field), {
      currencyCode: resolveCurrencyCode(field.options?.currencyCode, orgCurrencyCode),
      decimals: typeof decimals === 'number' ? decimals : undefined,
    })
  }
  return result
}
