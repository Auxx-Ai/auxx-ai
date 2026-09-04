// packages/lib/src/banking/feed/index.ts

/**
 * The Stripe Financial Connections bank feed (HANDOFF slot 3A).
 *
 * 🛑 Server-only. `normalizeMatchKey` is the one pure export a browser could want and
 * it is re-exported from `@auxx/lib/banking/client` rather than reached through here  -
 * this barrel pulls the Stripe SDK, the connector engine and Drizzle.
 */

export type {
  BankConnectionStart,
  BankFeedDisconnectResult,
  BankFeedSyncResult,
} from './actions'
export {
  BANK_FEED_PROVIDER_KEY,
  disconnectBankAccountFeed,
  startBankConnection,
  syncBankAccountFeed,
} from './actions'
export type { RefreshCoverageInput } from './coverage'
export { refreshBankAccountCoverage } from './coverage'
export type { FinancialConnectionsSessionRead } from './fc-client'
export {
  ACCOUNT_HOLDER_METADATA_KEY,
  createFinancialConnectionsSession,
  disconnectAccountAtStripe,
  FC_PROVIDER_KEY,
  readCustomerOrganizationId,
  readSessionAccounts,
  readStoredAccountHolderCustomerId,
  resolveAccountHolderCustomerId,
  retrieveAccount,
  subscribeToTransactions,
} from './fc-client'
export { financialConnectionsHandler } from './fc-connect'
export { normalizeMatchKey } from './match-key'
export type { BankTransactionPinInput } from './pins'
export { pinPostedBankTransaction, unpinPostedBankTransaction } from './pins'
export type {
  BankFeedAccountFacts,
  ProvisionBankFeedInput,
  ProvisionedBankFeed,
} from './provision'
export { provisionBankFeed } from './provision'
export type { ReapCandidate, ReapStats } from './reaper'
export {
  clearFeedDisconnectedAt,
  FEED_DISCONNECTED_AT_KEY,
  findReapableBankFeeds,
  REAP_AFTER_DAYS,
  reapBankFeedAccount,
  reapDisconnectedBankFeeds,
  stampFeedDisconnectedAt,
} from './reaper'
export type {
  FinancialConnectionsEvent,
  FinancialConnectionsEventType,
  ResolvedFeedConnector,
} from './webhook'
export {
  applyFinancialConnectionsEvent,
  FINANCIAL_CONNECTIONS_EVENT_TYPES,
  isFinancialConnectionsEvent,
  resolveFeedConnectorByAccountId,
} from './webhook'
