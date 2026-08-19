// packages/lib/src/data-deletion/index.ts
//
// Server entrypoint for the provider data-deletion / deauthorize module
// (plans/channels/meta-data-deletion-callback.md). Client code must import
// `@auxx/lib/data-deletion/client` instead — this barrel reaches the database,
// the notification service, and bullmq.

export type {
  DataDeletionKind,
  DataDeletionProvider,
  DataDeletionStatus,
  MetaDataDeletionKind,
} from './client'
export {
  buildDataDeletionStatusUrl,
  CONFIRMATION_CODE_ALPHABET,
  CONFIRMATION_CODE_LENGTH,
  DATA_DELETION_KINDS,
  DATA_DELETION_PROVIDERS,
  DATA_DELETION_STATUS_PATH,
  DATA_DELETION_STATUSES,
  generateConfirmationCode,
  isValidConfirmationCode,
  META_DATA_DELETION_KINDS,
} from './client'
export type {
  CreateDeletionRequestInput,
  CreatedDeletionRequest,
} from './create'
export { createDeletionRequest } from './create'
export type { DeletionRequestOutcome } from './execute'
export { executeDeletionRequest } from './execute'
export type { NotifyOrgOfMetaTeardownParams } from './notify'
export { notifyOrgOfMetaTeardown } from './notify'
export { getDeletionRequestByCode, getDeletionRequestById } from './read'
export type { ResolvedMetaChannel } from './resolve'
export { resolveMetaChannels } from './resolve'
