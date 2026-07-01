// packages/lib/src/identity/index.ts

export { getRecordIdentitiesForRecords } from './batch'
export { deleteRecordIdentity } from './delete'
export { findRecordByIdentity } from './find'
export {
  type ReconcileRecordIdentitiesResult,
  reconcileRecordIdentities,
} from './reconcile'
export type {
  DeleteRecordIdentityInput,
  FindRecordByIdentityInput,
  RecordIdentityMatch,
  UpsertRecordIdentityInput,
} from './types'
export { upsertRecordIdentity } from './upsert'
export {
  decorateRecordIdentities,
  getRecordIdentityViews,
  type RecordIdentityView,
} from './view'
