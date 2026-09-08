// apps/web/src/components/icons/institution-brands.ts

import { BRAND_ICONS, type BrandSlug } from './brands'

/**
 * What a bank account has to carry for a mark to be resolvable.
 *
 * Structurally typed rather than importing `BankAccountRow`, so this module
 * stays in `icons/` beside the manifest it is checked against and does not pull
 * the banking client into every screen that renders an icon.
 */
export interface InstitutionSubject {
  /** `bank_account_institution` - free text, whatever wrote the row. */
  institution: string | null
  /** The feed behind the account, when there is one. Null on a manual account. */
  connectorId: string | null
}

/**
 * Stripe Financial Connections `institution_name` values, verbatim and lowercased,
 * mapped to a brand mark in `BRAND_ICONS`.
 *
 * 🛑 **Keys are OBSERVED, never guessed.** Stripe publishes no institution list:
 * Financial Connections ships only `Accounts`, `Sessions` and `Transactions`,
 * the account object carries `institution_name` and no id, and the docs' own
 * *Supported institutions* page renders its table from a live widget with
 * nothing in the page text. The only way a name becomes known is that a real
 * connection wrote it into `bank_account_institution`.
 *
 * 🛑 **The name in the connect MODAL is not the name on the ACCOUNT**, so
 * harvesting the picker's list does not help. Stripe's test institutions are
 * listed as *Bank (Non-OAuth)*, *Test (OAuth)* and so on, yet the account linked
 * from one carries `institution_name: 'StripeBank'` - which is why that is the
 * only key here that has been proven.
 *
 * The map is many-to-one on purpose: if a bank turns out to write both
 * `Bank of America` and `BANK OF AMERICA, N.A.`, those are two keys pointing at
 * one slug, not a reason to start matching loosely.
 *
 * To add one: read the exact string
 * (`SELECT DISTINCT fv."valueText" FROM "FieldValue" fv JOIN "CustomField" cf ON
 * cf.id = fv."fieldId" WHERE cf."systemAttribute" = 'bank_account_institution'`),
 * lowercase it, and pair it with a slug that has a file on disk.
 */
export const STRIPE_INSTITUTIONS: Record<string, BrandSlug> = {
  // Stripe's Financial Connections test institution. Proven: it is what the
  // linked test account in the dev database actually carries.
  stripebank: 'stripe',
}

/**
 * The brand mark for an account's institution, or `null` when there is none to
 * show.
 *
 * Two rules, and they are the whole resolver:
 *
 * 1. 🛑 **Feed accounts only.** A manual account's institution is whatever a
 *    person typed - the dev database holds `Wells` and `Bank` - and no amount of
 *    matching turns that into a bank. `connectorId` is the gate.
 * 2. 🛑 **Exact match, case-folded.** No prefixes, no token subsets, no
 *    stripping of `N.A.` or `Bank`. Each of those is a way for one customer's
 *    account to wear another bank's logo, and the failure is silent: the icon is
 *    simply wrong, and looks deliberate.
 *
 * The `BrandSlug` return type is what makes a dangling `brand:` ref
 * unconstructible. `VisualIcon`'s brand branch renders a bare `<img>` and does
 * NOT fall back, so a slug with no file on disk is an empty frame with no error
 * (this is the `brand:openphone` bug `brands.test.ts` was written for). Every
 * `BrandSlug` is proven to have a file by that test.
 */
export function institutionBrandSlug(account: InstitutionSubject): BrandSlug | null {
  if (!account.connectorId) return null
  const key = account.institution?.trim().toLowerCase()
  if (!key) return null
  const slug = STRIPE_INSTITUTIONS[key]
  // The map's type already says this, but the runtime check costs nothing and
  // is the difference between a missing file and a blank square on a screen.
  return slug && slug in BRAND_ICONS ? slug : null
}

/**
 * The visual-ref for an institution: `brand:<slug>` when a mark is proven,
 * otherwise `null` so the caller renders its own fallback.
 *
 * @see institutionBrandSlug for why this is so conservative.
 */
export function institutionVisualRef(account: InstitutionSubject): string | null {
  const slug = institutionBrandSlug(account)
  return slug ? `brand:${slug}` : null
}
