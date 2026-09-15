// packages/lib/src/postings/source-account-label.ts
//
// The pure string form of a `FinancialSourceAccount`: no React, no fetch, so
// every site that renders `providerKey · externalAccountId` by hand agrees on
// one answer and the rules are unit-testable bare. Lives here (client-safe,
// `postings/client`) rather than in `apps/web` because `source-scope.ts`
// mints `RoleSourceRow.name` from the same three facts and needs the same
// function server-side (task 50 §7.9 - the schema half of §7.2's rendering fix).

import { MANUAL_SOURCE_EXTERNAL_ID, MANUAL_SOURCE_LABEL, MANUAL_SOURCE_PROVIDER_KEY } from './types'

/**
 * The facts a source account label needs.
 *
 * Structurally typed rather than importing a DTO, so every read path that
 * joins `FinancialSourceAccount` - `listSettlementSourceAccounts`, the
 * processor activity row, `source-scope.ts`'s `RoleSourceRow` - can pass its
 * own row without a shared type.
 */
export interface SourceAccountSubject {
  /** e.g. `shopify`, `shopify_payments`, `stripe`, `auxx`. */
  providerKey: string
  /** A shop domain, a `gid://`, a processor account id - whatever the provider uses. */
  externalAccountId: string
  /** `live` or `test`. Part of the identity, so it belongs in the tooltip. */
  environment?: string | null
  /**
   * `FinancialSourceAccount.name` - the label a person gave this account.
   * Null until somebody names it; every other field below is a fallback for
   * that case.
   */
  name?: string | null
}

/**
 * Human names for the provider keys in the `FinancialSourceAccount` namespace.
 *
 * The strings are borrowed from `PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS`
 * (`payment-gateways/client.ts`), but that map is keyed on *settlement sources*
 * (`stripe | shopify_payments | manual`) - a strictly narrower type than
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
 * long enough that it cannot be a name. A dot rules it out - a shop domain is
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
 * | `name` is set | the name, verbatim |
 * | `shopify` with no name | the `externalAccountId` verbatim - it is a shop domain, already a name |
 * | an opaque id with no name (`gid://…`) | `Shopify Payments ···3024` |
 * | anything else with no name | `Stripe · acct_123` |
 *
 * 🛑 `name` wins over every derivation below it, including the shop-domain
 * case: once somebody has named an account, showing the domain instead would
 * be reverting their choice. `externalAccountId` never changes meaning - it
 * stays the machine identity - only which string a person sees changes.
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
 * sourceAccountLabel({
 *   name: 'Primary payouts',
 *   providerKey: 'shopify_payments',
 *   externalAccountId: 'gid://shopify/ShopifyPaymentsAccount/999000223183024',
 * }) // 'Primary payouts'
 */
export function sourceAccountLabel(account: SourceAccountSubject): string {
  if (isManualSource(account)) return MANUAL_SOURCE_LABEL

  const name = account.name?.trim()
  if (name) return name

  const providerKey = account.providerKey?.trim().toLowerCase() ?? ''
  const externalAccountId = account.externalAccountId?.trim() ?? ''
  if (!externalAccountId) return sourceProviderLabel(providerKey) || MANUAL_SOURCE_LABEL

  // The store. `source-scope.ts` makes this call for every unnamed row, and
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
 * and keeps the whole string one hover away. Deliberately ignores `name` - the
 * tooltip's job is to expose the machine identity a label can hide, not to
 * repeat what the label already said.
 */
export function sourceAccountTooltip(account: SourceAccountSubject): string {
  if (isManualSource(account)) return `${MANUAL_SOURCE_LABEL} · not a connected account`

  const parts = [account.providerKey?.trim(), account.externalAccountId?.trim()].filter(Boolean)
  const environment = account.environment?.trim()
  if (environment) parts.push(environment)
  return parts.join(' · ')
}
