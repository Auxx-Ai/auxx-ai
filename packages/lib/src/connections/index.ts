// packages/lib/src/connections/index.ts
// Unified connection model: one provider blueprint (ConnectionDefinition) for
// apps, MCP servers, and platform built-ins, plus the shared runtime resolver,
// auth-apply helper, and refresh-config loader.

export {
  type AuthApply,
  applyAuth,
  type RequestParts,
  type RuntimeConnectionAuthData,
} from './auth-apply'
export {
  type HostedProvisionCompleteCtx,
  type HostedProvisionCompleteResult,
  type HostedProvisionHandler,
  type HostedProvisionStartCtx,
  resolveHostedProvisionHandler,
} from './hosted-provision'
export {
  makeClientCredentialsRequest,
  mintClientCredentialToken,
  type RefreshTokensResult,
  refreshCredentialTokens,
} from './oauth2-token-grants'
export {
  type PostConnectHook,
  type PostConnectHookContext,
  registerPostConnectHook,
  runPostConnectHook,
} from './post-connect-hooks'
export {
  BYO_CLIENT_KEYS,
  BYO_CLIENT_VARS,
  type ConnectionDefinitionForRefresh,
  type CredentialOwner,
  gateConnectionVariables,
  loadDefinitionForCredential,
  resolveOAuth2Client,
  resolveOAuth2RefreshConfig,
  resolveOwnClientRequirement,
} from './resolve-connection-definition'
export {
  type ResolveConnectionError,
  type RuntimeConnectionData,
  resolveConnectionForRuntime,
} from './resolve-connection-for-runtime'
export { resolveProviderKey, resolveProviderKeys } from './resolve-provider-key'
export { type SaveConnectionInput, saveConnection } from './save-connection'
export {
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
  httpTransport,
  postgresTransport,
  type SqlRow,
  type SqlTransport,
  type Transport,
  type TransportKind,
  transportFor,
} from './transports'
