// Channel cache - cached provider lookup for batch operations
export { getOrgChannelProviderMap, invalidateOrgChannelProviderMap } from './channel-cache'
export {
  DEFAULT_IMPORT_BATCH_SIZE,
  PROVIDER_IMPORT_BATCH_SIZE,
} from './channel-provider.interface'
export { ChannelService } from './channel-service'
export type { ChannelTokens } from './channel-token-accessor'
export { ChannelTokenAccessor } from './channel-token-accessor'
export { EmailForwardingProvider } from './email'
export type { FacebookIntegrationMetadata } from './facebook/facebook-oauth'
export { FacebookOAuthService } from './facebook/facebook-oauth'
export type { CreateGoogleMeetParams, CreateGoogleMeetResult } from './google/calendar/create-event'
export { createGoogleMeetEvent } from './google/calendar/create-event'
export { GoogleOAuthService } from './google/google-oauth'
export type { ImapCredentialData, LdapUserInfo } from './imap'
// IMAP/SMTP/LDAP provider
export { ImapClientProvider, ImapProvider, ImapSmtpSendService, LdapAuthService } from './imap'
export type { InstagramIntegrationMetadata } from './instagram/instagram-oauth'
export { InstagramOAuthService } from './instagram/instagram-oauth'
export type { OutlookErrorCode } from './outlook/outlook-errors'
export { OutlookProviderError, parseGraphApiError, parseMsalError } from './outlook/outlook-errors'
export { OutlookOAuthService } from './outlook/outlook-oauth'
export type { BYOCProvider } from './provider-credentials-config'
export { PROVIDER_CREDENTIAL_CONFIG } from './provider-credentials-config'
export { ProviderRegistryService } from './provider-registry-service'
// Query helpers - replace removed integrationType/messageType columns
export {
  getEmailProviders,
  getSmsProviders,
  getSocialProviders,
  whereMessageMessageType,
  whereMessageProvider,
  whereThreadMessageType,
  whereThreadProvider,
} from './query-helpers'
// Type utilities - single source of truth for provider/message type derivation
export {
  getMessageTypeFromProvider,
  getProviderForMessage,
  getProviderForThread,
  getProvidersForMessages,
  getProvidersForThreads,
} from './type-utils'
export { WebhookManagerService } from './webhook-manager-service'
