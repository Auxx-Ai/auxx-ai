// packages/lib/src/accounting/providers/client.ts
//
// The client-safe half of `accounting/providers/`: the agreement vocabulary and
// the pure identity suggestion (docs/lib-module-guide.md §7).
//
// NOTE: no 'use client' directive - server code imports this file too, and the
// directive would turn every export into a client-reference proxy there.

// ── plans/accounting/tasks/20 §8: do our books and theirs agree ─────────────
// PURE. No database, no io, no clock - reaches only `errors`, `account-label`
// and two type-only imports. See provider-agreement.ts's own header.
export {
  type PlanProviderAgreementInput,
  type ProviderAgreement,
  type ProviderAgreementRow,
  type ProviderAgreementStatus,
  planProviderAgreement,
} from './provider-agreement'
// PURE: the bulk create-and-link's send order, previewed by the chart tab's confirm.
export { providerCreateOrder } from './provider-create-order'
export {
  type AccountSuggestion,
  isMappableTo,
  SUBTYPE_PROVIDER_ACCOUNT_TYPES,
  suggestAccountIdentities,
  validateProviderMapping,
} from './suggest-account-identities'
