// packages/lib/src/identity/index.ts

export { getRecordIdentitiesForRecords } from './batch'
export { deleteRecordIdentity } from './delete'
export {
  type ResolveExternalLinkInput,
  resolveExternalLink,
} from './external-link'
export { findRecordByIdentity } from './find'
export {
  interpolateLinkTemplate,
  LINK_VARIABLE,
  type LinkVariable,
  parseLinkTemplate,
} from './link-template'
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
