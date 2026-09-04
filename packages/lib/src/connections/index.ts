// packages/lib/src/connections/index.ts
// Unified connection model: one provider blueprint (ConnectionDefinition) for
// apps, MCP servers, and platform built-ins, plus the shared runtime resolver,
// auth-apply helper, and refresh-config loader.

// The OAuth2 token-production + definition-resolution cluster moved to
// `@auxx/credentials/connections` so consumers below the lib tier (notably `@auxx/billing`) can
// refresh on use too. Re-exported here so existing `@auxx/lib/connections` imports keep working.
export {
  BYO_CLIENT_KEYS,
  BYO_CLIENT_VARS,
  type ConnectionDefinitionForRefresh,
  type CredentialLockProvider,
  type CredentialOwner,
  effectiveConnectionVariables,
  ensureFreshCredentialToken,
  gateConnectionVariables,
  loadDefinitionForCredential,
  makeClientCredentialsRequest,
  mintClientCredentialToken,
  parseScopeAddParam,
  type RefreshTokensResult,
  refreshCredentialTokens,
  resolveGrantedScopes,
  resolveOAuth2Client,
  resolveOAuth2RefreshConfig,
  resolveOwnClientRequirement,
  resolveRequestedScopes,
  splitConnectionVariablesBySecrecy,
} from '@auxx/credentials/connections'
export {
  type AuthApply,
  applyAuth,
  type RequestParts,
  type RuntimeConnectionAuthData,
} from './auth-apply'
export {
  CONNECTION_SETTLED_EVENT,
  type ConnectionSettledEvent,
} from './connect-events'
export {
  type HostedProvisionCompleteCtx,
  type HostedProvisionCompleteResult,
  type HostedProvisionHandler,
  type HostedProvisionStartCtx,
  type HostedProvisionStartResult,
  resolveHostedProvisionHandler,
} from './hosted-provision'
export {
  appOAuthCallbackUrl,
  oauthCallbackBase,
  providerOAuthCallbackUrl,
} from './oauth-callback-url'
export {
  NO_OWN_CLIENT_GATE,
  type OwnClientGate,
  type OwnClientGateDefinition,
  type OwnClientReason,
  resolveOwnClientGateForOrg,
  stripUnentitledOwnClientVars,
} from './own-client-gate'
export {
  clearPendingSelection,
  deleteSupersededPendingCredentials,
  findPendingSelectionForUser,
  type PendingConnectSelection,
  type PendingSelectionKind,
  type PendingSelectionRow,
  readPendingSelection,
  writePendingSelection,
} from './pending-selection'
export {
  type PostConnectHook,
  type PostConnectHookContext,
  type PostConnectHookResult,
  registerPostConnectHook,
  runPostConnectHook,
} from './post-connect-hooks'
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
