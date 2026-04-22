// packages/lib/src/placeholders/client.ts
//
// Client-safe surface of the placeholders module. Re-exports only the pure
// token parser and fallback codec — never imports `FieldValueService`,
// bullmq, or any other server-only dependency. See CLAUDE.md "Client vs
// Server Imports".

export {
  decodeFallback,
  encodeFallback,
  type FallbackPayload,
  type FallbackSupportedType,
  isFallbackSupportedType,
  renderFallbackPayload,
} from './fallback-codec'
export {
  type DateSlug,
  type OrgSlug,
  type ParsedPlaceholder,
  parsePlaceholderId,
  tryParsePlaceholderId,
} from './path-parser'
