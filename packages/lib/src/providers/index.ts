export type { FacebookIntegrationMetadata } from './facebook/facebook-oauth'
export { FacebookOAuthService } from './facebook/facebook-oauth'

export { GoogleOAuthService } from './google/google-oauth'
export type { InstagramIntegrationMetadata } from './instagram/instagram-oauth'
export { InstagramOAuthService } from './instagram/instagram-oauth'
// Integration cache - cached provider lookup for batch operations
export { getOrgProviderMap, invalidateOrgProviderMap } from './integration-cache'
export { IntegrationService } from './integration-service'
export type { IntegrationTokens } from './integration-token-accessor'
export { IntegrationTokenAccessor } from './integration-token-accessor'
export { OutlookOAuthService } from './outlook/outlook-oauth'
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
  integrationTypeToProvider,
} from './type-utils'
export { WebhookManagerService } from './webhook-manager-service'
