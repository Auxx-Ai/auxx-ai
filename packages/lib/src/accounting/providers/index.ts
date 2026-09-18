// packages/lib/src/accounting/providers/index.ts
//
// Server entry point for the `AccountingProvider` seam: the interface, the book
// connection it is pinned to, and account identities on the provider's side.
// The one implementation lives in `./quickbooks`.
//
// Client code must import `@auxx/lib/accounting/providers/client`, never this
// barrel.

export {
  type AccountIdentityMap,
  confirmSuggestedIdentities,
  listAccountIdentities,
  resolveProviderAccountIds,
  type SetAccountIdentityOptions,
  setAccountIdentity,
} from './account-identities'
export {
  type ActivateAccountingBookConnectionInput,
  accountingOpeningPolicySchema,
  activateAccountingBookConnection,
  activateAccountingBookConnectionInTx,
  type PinnedAccountingConnection,
  readAccountingBookConnectionStatus,
  readActiveBookConnection,
  readPinnedAccountingConnection,
  readPinnedAccountingConnectionInTx,
  repairAccountingBookConnection,
} from './book-connections'
export {
  type CreateAndLinkOptions,
  type CreateAndLinkResult,
  createAndLinkProviderAccount,
} from './create-provider-account'
export {
  type AccountingProvider,
  type AccountingProviderFactory,
  type ConnectedProviderResolver,
  type CreateProviderAccountInput,
  type CreateProviderAccountResult,
  getAccountingProvider,
  listAccountingProviderIds,
  NONE_ACCOUNTING_PROVIDER,
  NONE_PROVIDER_ID,
  registerAccountingProvider,
  resolveAccountingProvider,
  setConnectedProviderResolver,
  supportsCreatingProviderAccounts,
} from './provider'
// ── plans/accounting/tasks/20 §8: do our books and theirs agree, pure ───────
export {
  type PlanProviderAgreementInput,
  type ProviderAgreement,
  type ProviderAgreementRow,
  type ProviderAgreementStatus,
  planProviderAgreement,
} from './provider-agreement'
export {
  type AccountSuggestion,
  isMappableTo,
  SUBTYPE_PROVIDER_ACCOUNT_TYPES,
  suggestAccountIdentities,
  validateProviderMapping,
} from './suggest-account-identities'
