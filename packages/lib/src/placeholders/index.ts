// packages/lib/src/placeholders/index.ts

export {
  type BuildContextInput,
  buildPlaceholderContextForThread,
} from './context'
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
  type PlaceholderResolutionContext,
  resolvePlaceholdersInHtml,
} from './resolver'
