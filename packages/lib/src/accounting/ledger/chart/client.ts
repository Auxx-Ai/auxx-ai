// packages/lib/src/accounting/ledger/chart/client.ts

export { accountLabel, compareAccountsByCodeThenName, type NamedAccount } from './account-label'
export {
  accountSubtypeLabel,
  GL_ACCOUNT_SUBTYPES,
  type GlAccountSubtypeValue,
} from './account-subtype'
export {
  type AccountNode,
  accountDepth,
  accountPath,
  accountPathLabel,
  buildAccountTree,
  descendantIds,
  sortChartTree,
} from './account-tree'
// ── plans/accounting/tasks/16: the chart import, pure half ─────────────────
// PURE. The two declared tables and the planner reach nothing but types.
export {
  PROVIDER_ACCOUNT_TYPE_SUBTYPE,
  planChartImport,
  ROLE_IMPORT_MATCH,
} from './chart-import-plan'
export {
  type AccountCodeBand,
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPack,
  type ChartPackKey,
  CLEARING_ACCOUNT_CODE_BAND,
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
  GL_ACCOUNT_TYPES,
  type GlAccountTypeValue,
  MERCHANT_FEE_ACCOUNT_CODE_BAND,
  packForRole,
  packState,
} from './default-chart'
// ── plans/accounting/tasks/26 §7.1: the code allocator ──────────────────────
// PURE - reaches `errors` and the band constants in `default-chart`, both of
// which are already on this surface. `mint-rail-accounts.ts` is the write half
// and stays server-only: it imports `@auxx/database`.
export { type CodedAccount, nextAccountCode } from './next-account-code'
// The shared `FinancialSourceAccount` label: `name` first, then a
// provider-aware derivation, so every renderer - and `source-scope.ts`'s
// `RoleSourceRow.name` - agrees on one answer instead of five copies of
// `providerKey · externalAccountId`.
export {
  isManualSource,
  type SourceAccountSubject,
  sourceAccountLabel,
  sourceAccountTooltip,
  sourceProviderLabel,
} from './source-account-label'
