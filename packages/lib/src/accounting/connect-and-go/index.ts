// packages/lib/src/accounting/connect-and-go/index.ts
//
// Server entry point. Client code imports `@auxx/lib/accounting/connect-and-go/client`.

export {
  activateBookConnectionForSetup,
  exportFromDateForCutoff,
} from './activate-book-connection'
export { autoRouteRails } from './auto-route-rails'
export { previewConnectAndGoBacklog } from './backlog-preview'
export { planBankAccountsFromProvider } from './bank-account-reads'
export { applyBankAccountProposals } from './bank-account-writes'
export type {
  ConnectAndGoAnswers,
  ConnectAndGoBacklogPreview,
  ConnectAndGoCompleteReport,
  ConnectAndGoPrepareReport,
} from './client'
export { completeConnectAndGo } from './complete'
export { prepareConnectAndGo } from './prepare'
export { enqueueConnectAndGoPrepare, registerConnectAndGoTrigger } from './trigger'
