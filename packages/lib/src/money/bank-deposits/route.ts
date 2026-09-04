// packages/lib/src/money/bank-deposits/route.ts

/**
 * Where a received payment lands in the ledger, by METHOD
 * (plans/accounting/tasks/06-deposit-grouping.md §2.3).
 *
 * PURE and client-safe. No database, no clock, no imports outside this package's
 * own client half - the settings form, the payment builder (wave 2) and the
 * undeposited list all read the same function, which is the whole point.
 *
 * ## Why a table and never an inference
 *
 * 🛑 Three rails get three treatments and getting one wrong breaks bank matching
 * SILENTLY for every payment on that rail:
 *
 * - **Cheque and cash** are banked in a run. Five cheques deposited together
 *   arrive at the bank as ONE line, so five separate cash postings can never
 *   match it. They must sit in `undeposited_funds` until a `bank_deposit`
 *   groups them and posts the single `Dr cash Cr undeposited_funds` line.
 * - **ACH and wire** arrive alone and match their own bank line, so they post
 *   straight to cash and are never grouped.
 * - **Card** settles as a NET payout days later, gross minus the processor's
 *   fee. It posts to a clearing account which the payout entry drains
 *   (tasks/01 §1.3). ⚠️ A card receipt must never route through undeposited
 *   funds: the deposit would assert a gross amount the bank never credited.
 *
 * Every one of those wrong answers still BALANCES, which is why the mapping is
 * declared per method in one place rather than derived per payment.
 */

/** How a payment was collected. Mirrors `PaymentMethod` in `money/types.ts`. */
export type PaymentRouteMethod = 'cash' | 'check' | 'card' | 'bank' | 'other'

/**
 * The three destinations a received payment can be routed to.
 *
 * - `undeposited_funds` - held until a bank deposit groups it. The
 *   {@link ACCOUNT_ROLES.UNDEPOSITED_FUNDS} role, and its whole job is to be
 *   ZERO once everything has cleared; a non-zero balance is a list of money
 *   received and never banked, which is a useful control on its own.
 * - `cash` - straight to the bank account. Only for a rail that arrives as its
 *   own bank line.
 * - `clearing` - a processor's settlement account, drained by the payout entry.
 */
export type PaymentRoute = 'undeposited_funds' | 'cash' | 'clearing'

/** The `SINGLE_SELECT` options the `accounting.paymentRoute.*` settings render. */
export const PAYMENT_ROUTE_SETTING_OPTIONS = [
  { label: 'Undeposited funds', value: 'undeposited_funds', color: 'amber' },
  { label: 'Cash / bank account', value: 'cash', color: 'green' },
  { label: 'Clearing account', value: 'clearing', color: 'blue' },
] as const

/** Every `accounting.paymentRoute.<method>` key, keyed by the method it routes. */
export const PAYMENT_ROUTE_SETTING_KEYS = {
  cash: 'accounting.paymentRoute.cash',
  check: 'accounting.paymentRoute.check',
  card: 'accounting.paymentRoute.card',
  bank: 'accounting.paymentRoute.bank',
  other: 'accounting.paymentRoute.other',
} as const satisfies Record<PaymentRouteMethod, string>

/**
 * The shipped default per method - the same values the catalog declares, kept
 * here so {@link resolvePaymentRoute} can answer with NO settings loaded at all.
 *
 * 🛑 These two copies must agree, and a test pins them. The catalog's
 * `defaultValue` is what a settings form renders; this is what the builder
 * falls back to when the org has never opened that form. A divergence would
 * make the screen say one thing and the ledger do another.
 */
export const DEFAULT_PAYMENT_ROUTES = {
  cash: 'undeposited_funds',
  check: 'undeposited_funds',
  card: 'clearing',
  bank: 'cash',
  other: 'undeposited_funds',
} as const satisfies Record<PaymentRouteMethod, PaymentRoute>

function isPaymentRoute(value: unknown): value is PaymentRoute {
  return value === 'undeposited_funds' || value === 'cash' || value === 'clearing'
}

/**
 * Which ledger destination a payment of `method` routes to for this org.
 *
 * PURE. `settings` is whatever the caller read out of the settings service,
 * keyed by the full setting key; an absent, blank or unrecognised value falls
 * back to {@link DEFAULT_PAYMENT_ROUTES}.
 *
 * ⚠️ **Falling back rather than throwing is deliberate.** This runs on the
 * posting path for every receipt, and an org that has never opened the settings
 * page has no rows at all. Refusing there would stop payments posting for a
 * setting nobody knew existed; the shipped defaults are the accounting-correct
 * answer for all five rails, so the fallback is the right answer rather than a
 * guess. An unknown method is the one case with no right answer, and it takes
 * the `other` row - the safe unknown.
 *
 * @param method How the payment was collected.
 * @param settings Setting key to raw value, e.g. from `getOrganizationSettings`.
 */
export function resolvePaymentRoute(
  method: string | null | undefined,
  settings: Record<string, unknown> | null | undefined
): PaymentRoute {
  const key = (method ?? 'other') as PaymentRouteMethod
  const settingKey = PAYMENT_ROUTE_SETTING_KEYS[key] ?? PAYMENT_ROUTE_SETTING_KEYS.other
  const configured = settings?.[settingKey]
  if (isPaymentRoute(configured)) return configured
  return DEFAULT_PAYMENT_ROUTES[key] ?? DEFAULT_PAYMENT_ROUTES.other
}

/** Every method whose route is `undeposited_funds` for this org - the undeposited list's filter. */
export function methodsRoutedToUndepositedFunds(
  settings: Record<string, unknown> | null | undefined
): PaymentRouteMethod[] {
  return (Object.keys(PAYMENT_ROUTE_SETTING_KEYS) as PaymentRouteMethod[]).filter(
    (method) => resolvePaymentRoute(method, settings) === 'undeposited_funds'
  )
}
