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
  type ConnectionDefinitionForRefresh,
  type CredentialOwner,
  loadDefinitionForCredential,
  resolveOAuth2RefreshConfig,
} from './resolve-connection-definition'
export {
  type ResolveConnectionError,
  type RuntimeConnectionData,
  resolveConnectionForRuntime,
} from './resolve-connection-for-runtime'
