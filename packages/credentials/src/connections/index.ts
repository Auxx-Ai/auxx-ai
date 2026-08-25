// packages/credentials/src/connections/index.ts
// OAuth2 credential token lifecycle: resolve a credential's ConnectionDefinition, produce a fresh
// access token (refresh_token / client_credentials grants), and serialise that work per credential.
//
// Lives here rather than in `@auxx/lib` because every primitive it needs — reveal/rotate secrets,
// record refresh outcomes, decrypt the stored client id/secret — is already in this package, and
// because consumers below the lib tier (notably `@auxx/billing`) need refresh-on-use too.

export {
  type CredentialLockProvider,
  ensureFreshCredentialToken,
} from './ensure-fresh-credential-token'
export { getAppConnection } from './get-app-connection'
export {
  extractPlaceholders,
  interpolateConnectionFields,
  mergeConnectionVariables,
} from './interpolate-connection'
export {
  makeClientCredentialsRequest,
  mintClientCredentialToken,
  OAuth2TokenRequestError,
  type RefreshTokensResult,
  refreshCredentialTokens,
} from './oauth2-token-grants'
export {
  BYO_CLIENT_KEYS,
  BYO_CLIENT_VARS,
  type ConnectionDefinitionForRefresh,
  type CredentialOwner,
  effectiveConnectionVariables,
  gateConnectionVariables,
  loadDefinitionForCredential,
  resolveOAuth2Client,
  resolveOAuth2RefreshConfig,
  resolveOwnClientRequirement,
  splitConnectionVariablesBySecrecy,
} from './resolve-connection-definition'
export type { DecryptedConnectionData } from './types'
