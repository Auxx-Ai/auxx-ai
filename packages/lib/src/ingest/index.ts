// packages/lib/src/ingest/index.ts

// Orchestrators
export { type BatchStoreOptions, batchStoreMessages } from './batch-store-messages'
// Companies / Domains (already existed)
export { findOrCreateCompanyByDomain } from './companies/find-or-create'
export type { LinkContactArgs } from './companies/link-contact'
export { linkContactToCompanyByDomain } from './companies/link-contact'
// Contacts
export { createContactAfterOutboundMessage } from './contacts/create-after-outbound'
export { ensureContactsForRecipients } from './contacts/ensure-for-recipients'
export { findOrCreateContactForParticipant } from './contacts/find-or-create'
export { hasOrganizationSentToParticipant } from './contacts/has-sent-to'
// Context
export type { CreateIngestContextOptions, IngestContext } from './context'
export { createIngestContext, normalizeOwnEmails, resetBatchCaches } from './context'
export { deleteMessagesByExternalIds } from './delete-messages'
export {
  classifyForCompany,
  extractRegistrableDomain,
  getOwnDomains,
  isExcludedTld,
  isOwnDomain,
  isPersonalDomain,
  normalizeDomain,
} from './domain/classifier'
export { EXCLUDED_TLDS } from './domain/excluded-tlds'
export { PERSONAL_EMAIL_DOMAINS } from './domain/personal-domains'
// Filtering
export { matchesFilterEntry } from './filtering/matches-filter'
export { shouldIgnoreMessage } from './filtering/should-ignore'
export { storeIgnoredMessage } from './filtering/store-ignored'
// Participants
export {
  calculateDisplayName,
  calculateInitials,
  getNamesFromParticipant,
} from './participants/display'
export { findOrCreateParticipantRecord } from './participants/find-or-create'
export { determineIdentifierType, normalizeIdentifier } from './participants/normalize'
// Reconciliation
export { extractInternetMessageId } from './reconciliation/extract-internet-message-id'
export { isSimilarSubject } from './reconciliation/is-similar-subject'
export { mergeProviderData } from './reconciliation/merge-provider-data'
export { reconcileMessage } from './reconciliation/reconcile-message'
export { storeMessage } from './store-message'
// Threads
export { getThread, getThreadMessages } from './threads/get'
export { updateThreadMetadataEfficient } from './threads/update-metadata'
// Types
export type {
  IntegrationSettings,
  MessageAttachmentMeta,
  MessageData,
  ParticipantInputData,
} from './types'
