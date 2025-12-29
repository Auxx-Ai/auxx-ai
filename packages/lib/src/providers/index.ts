export { IntegrationService } from './integration-service'
export { WebhookManagerService } from './webhook-manager-service'

export { GoogleOAuthService } from './google/google-oauth'
export { OutlookOAuthService } from './outlook/outlook-oauth'
export { FacebookOAuthService } from './facebook/facebook-oauth'
export { InstagramOAuthService } from './instagram/instagram-oauth'
export type { InstagramIntegrationMetadata } from './instagram/instagram-oauth'
export type { FacebookIntegrationMetadata } from './facebook/facebook-oauth'
export { ProviderRegistryService } from './provider-registry-service'

// Type utilities - single source of truth for provider/message type derivation
export {
  getMessageTypeFromProvider,
  integrationTypeToProvider,
  getProviderForMessage,
  getProviderForThread,
  getProvidersForMessages,
  getProvidersForThreads,
} from './type-utils'

// Query helpers - replace removed integrationType/messageType columns
export {
  whereThreadProvider,
  whereMessageProvider,
  whereThreadMessageType,
  whereMessageMessageType,
  getEmailProviders,
  getSocialProviders,
  getSmsProviders,
} from './query-helpers'
