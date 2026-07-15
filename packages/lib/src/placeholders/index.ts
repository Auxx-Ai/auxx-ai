// packages/lib/src/placeholders/index.ts

export {
  type BuildContextInput,
  buildPlaceholderContextForThread,
} from './context'
export { resolvePlaceholdersInDocument } from './document-resolver'
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
  type ParsedPlaceholder,
  parsePlaceholderId,
  tryParsePlaceholderId,
} from './path-parser'
export {
  formatFieldValueForText,
  type PlaceholderResolutionContext,
  type ResolvedFieldToken,
  resolveFieldTokens,
  resolvePlaceholdersInHtml,
} from './resolver'
