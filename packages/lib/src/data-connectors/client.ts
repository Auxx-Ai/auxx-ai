// packages/lib/src/data-connectors/client.ts
// Client-safe entry for Data Connectors — the UI imports from here so it never
// pulls the server barrel (`./index.ts`, which drags in BullMQ/crypto/etc.).
// Keep this to pure, browser-safe symbols only.

export type { ConnectorReadiness, ReadinessProblem, ReadinessStream } from './readiness'
export { getConnectorReadiness, READINESS_REASON } from './readiness'
export type {
  CellSyncInfo,
  CellSyncState,
  InstanceConnectorBinding,
  SyncBinding,
  SyncFieldShape,
} from './sync-state'
export { refNamesField, resolveCellSyncState, wouldHealField } from './sync-state'
