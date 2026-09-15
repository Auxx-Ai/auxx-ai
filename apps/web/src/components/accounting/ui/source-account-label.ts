// apps/web/src/components/accounting/ui/source-account-label.ts
//
// The pure half of `source-account-badge.tsx`: string forms of a
// `FinancialSourceAccount` with no React and no fetch, so the five sites that
// render `providerKey · externalAccountId` by hand agree on one answer and so
// the rules are unit-testable bare. `gateway-settlement-fields.tsx` needs a
// plain `Select` option string, not a node, and takes these without the badge.

import {
  MANUAL_SOURCE_EXTERNAL_ID,
  MANUAL_SOURCE_LABEL,
  MANUAL_SOURCE_PROVIDER_KEY,
} from '@auxx/lib/postings/client'

/**
 * The three facts a source account label needs.
 *
 * Structurally typed rather than importing a DTO, so every read path that joins
 * `FinancialSourceAccount` — `transferDto`, the processor activity row, the
 * payouts list — can pass its own row without a shared type.
 *
 * 🛑 There is no `name` here because the table has no name column, and this is a
 * rendering fix rather than a schema one (task 50 §7.2). Identity is the
 * four-tuple `(organizationId, providerKey, externalAccountId, environment)`.
 */
export interface SourceAccountSubject {
  /** e.g. `shopify`, `shopify_payments`, `stripe`, `auxx`. */
  providerKey: string
  /** A shop domain, a `gid://`, a processor account id — whatever the provider uses. */
  externalAccountId: string
  /** `live` or `test`. Part of the identity, so it belongs in the tooltip. */
  environment?: string | null
}

/**
 * Human names for the provider keys in the `FinancialSourceAccount` namespace.
 *
 * The strings are borrowed from `PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS`
 * (`payment-gateways/client.ts`), but that map is keyed on *settlement sources*
 * (`stripe | shopify_payments | manual`) — a strictly narrower type than
 * `providerKey`, which also carries `shopify` and `auxx`. Reuse the strings; do
 * NOT reuse the type, or half this namespace becomes unrepresentable.
 */
const SOURCE_PROVIDER_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  shopify_payments: 'Shopify Payments',
  stripe: 'Stripe',
  [MANUAL_SOURCE_PROVIDER_KEY]: MANUAL_SOURCE_LABEL,
}

/** How long a single token may be before it reads as an id rather than a name. */
const OPAQUE_ID_MIN_LENGTH = 24

/**
 * Is this the manual sentinel bucket rather than a connected account?
 *
 * Matches the provider key `auxx` and also the bare string `manual`, which is
 * how the settlement-source vocabulary spells the same idea. Nothing else is
 * manual: an account exists because a connector wrote it.
 */
export function isManualSource(account: SourceAccountSubject): boolean {
  const key = account.providerKey?.trim().toLowerCase()
  return key === MANUAL_SOURCE_PROVIDER_KEY || key === MANUAL_SOURCE_EXTERNAL_ID
}

/**
 * `shopify_payments` -> `Shopify Payments`. An unmapped key is titled rather
 * than dropped: a provider we have not named yet still has to read as a word,
 * not as a snake_case token.
 */
export function sourceProviderLabel(providerKey: string): string {
  const key = providerKey?.trim().toLowerCase()
  if (!key) return ''
  const known = SOURCE_PROVIDER_LABELS[key]
  if (known) return known
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * An id with no human content: a Shopify `gid://`, or any single unbroken token
 * long enough that it cannot be a name. A dot rules it out — a shop domain is
 * `acme.myshopify.com`, which IS the account's name and must survive verbatim.
 */
function isOpaqueExternalId(externalAccountId: string): boolean {
  if (externalAccountId.startsWith('gid://')) return true
  if (externalAccountId.includes('.')) return false
  if (/\s/.test(externalAccountId)) return false
  return externalAccountId.length > OPAQUE_ID_MIN_LENGTH
}

/**
 * The short, human name for a source account. Never an opaque id in full.
 *
 * | Case | Result |
 * |---|---|
 * | the manual bucket | `Manual` |
 * | `shopify` | the `externalAccountId` verbatim — it is a shop domain, already a name |
 * | an opaque id (`gid://…`) | `Shopify Payments ···3024` |
 * | anything else | `Stripe · acct_123` |
 *
 * 🛑 For the opaque case the TAIL is kept, not the head. The head of a `gid://`
 * is the type (`gid://shopify/ShopifyPaymentsAccount/`), identical across every
 * row of that kind; the distinguishing part of an opaque id is its last digits.
 * Same shape and same reason as `BankAccountBadge`'s `last4`, down to the `···`
 * prefix, so the two badges read as one family.
 *
 * @example
 * sourceAccountLabel({ providerKey: 'shopify', externalAccountId: 'acme.myshopify.com' })
 * // 'acme.myshopify.com'
 * sourceAccountLabel({
 *   providerKey: 'shopify_payments',
 *   externalAccountId: 'gid://shopify/ShopifyPaymentsAccount/999000223183024',
 * }) // 'Shopify Payments ···3024'
 */
export function sourceAccountLabel(account: SourceAccountSubject): string {
  if (isManualSource(account)) return MANUAL_SOURCE_LABEL

  const providerKey = account.providerKey?.trim().toLowerCase() ?? ''
  const externalAccountId = account.externalAccountId?.trim() ?? ''
  if (!externalAccountId) return sourceProviderLabel(providerKey) || MANUAL_SOURCE_LABEL

  // The store. `source-scope.ts:214` already made this call for every row, and
  // for this one it is right: a shop domain is the account's name.
  if (providerKey === 'shopify') return externalAccountId

  if (isOpaqueExternalId(externalAccountId)) {
    const tail = externalAccountId.split('/').filter(Boolean).at(-1) ?? externalAccountId
    return `${sourceProviderLabel(providerKey)} ···${tail.slice(-4)}`
  }

  return `${sourceProviderLabel(providerKey)} · ${externalAccountId}`
}

/**
 * The full identity, for a tooltip: `shopify_payments · gid://… · live`.
 *
 * This exists because {@link sourceAccountLabel} throws away an id that somebody
 * may have to paste into a provider dashboard. The badge shows the short form
 * and keeps the whole string one hover away.
 */
export function sourceAccountTooltip(account: SourceAccountSubject): string {
  if (isManualSource(account)) return `${MANUAL_SOURCE_LABEL} · not a connected account`

  const parts = [account.providerKey?.trim(), account.externalAccountId?.trim()].filter(Boolean)
  const environment = account.environment?.trim()
  if (environment) parts.push(environment)
  return parts.join(' · ')
}
