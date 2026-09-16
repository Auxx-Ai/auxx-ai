// packages/lib/src/postings/export-gate/index.ts
//
// Server entry point for the PRE-EXPORT RECONCILIATION GATE
// (plans/accounting/tasks/53-two-modes-one-ledger.md D12).
//
// Check the internal ledger against the source and the bank BEFORE anything is
// sent, per posting, in words an operator can act on. See `reads.ts` for what
// the three checks are and why only two of them block.
//
// Client code must import `@auxx/lib/postings/client`, never this barrel.

export {
  CLAIMED_SOURCE_STREAMS,
  claimedSourceStreams,
  describeBankCoverageGap,
  describeUnbalancedEntry,
  describeUnreviewedBankLines,
  EXPORT_GATE_CHECKS,
  type ExportGateCheck,
  type ExportGateFinding,
  type ExportGateFindingKey,
  type ExportGateReport,
  type ExportGateSeverity,
  type ExportGateStatus,
  type ExportGateVerdict,
  exportGateLead,
  exportGateMessage,
  exportGateStatus,
  liftCloseBlockerItem,
} from './client'
export { type EvaluateExportGateInput, evaluateExportGate } from './reads'
export { releaseExportsThroughGate } from './release'
