// packages/lib/src/postings/export-gate/client.ts
//
// Client-safe surface of the pre-export reconciliation gate. Types and the pure
// prose functions only - the reads pull `@auxx/database` and three subledgers.
//
// No `'use client'` directive: server code imports these too, and the directive
// would turn every export into a client-reference proxy there
// (`docs/lib-module-guide.md` §7).

export {
  CLAIMED_SOURCE_STREAMS,
  claimedSourceStreams,
  describeBankCoverageGap,
  describeUnbalancedEntry,
  describeUnreviewedBankLines,
  exportGateLead,
  exportGateMessage,
  exportGateStatus,
  liftCloseBlockerItem,
} from './findings'
export {
  EXPORT_GATE_CHECKS,
  type ExportGateCheck,
  type ExportGateFinding,
  type ExportGateFindingKey,
  type ExportGateReport,
  type ExportGateSeverity,
  type ExportGateStatus,
  type ExportGateVerdict,
} from './types'
