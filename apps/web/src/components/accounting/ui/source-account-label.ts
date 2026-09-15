// apps/web/src/components/accounting/ui/source-account-label.ts
//
// Thin re-export. The pure `FinancialSourceAccount` label logic now lives in
// `@auxx/lib/postings/client` (`source-account-label.ts`) so `source-scope.ts`
// can share it server-side too (task 50 §7.9). Kept as a local module so the
// existing imports in `source-account-badge.tsx` and `gateway-settlement-fields.tsx`
// do not have to move.

export {
  isManualSource,
  type SourceAccountSubject,
  sourceAccountLabel,
  sourceAccountTooltip,
  sourceProviderLabel,
} from '@auxx/lib/postings/client'
