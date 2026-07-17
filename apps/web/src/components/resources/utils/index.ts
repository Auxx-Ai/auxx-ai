// apps/web/src/components/resources/utils/index.ts

export {
  // Both key halves canonical — queue/subscriber/request key builder
  buildCanonicalFieldValueKey,
  // Canonicalize FieldReference definition segments (incl. FieldPath drill-downs)
  canonicalizeFieldRef,
} from './canonicalize-field-ref'
export type { GetRecordLinkOptions } from './get-record-link'
export {
  // Pure function (requires resource object)
  getRecordLink,
  // Predicate: does this resource have a full detail page?
  resourceHasDetailPage,
  // Hook (auto-fetches resource from provider)
  useRecordLink,
} from './get-record-link'
export {
  // Resolvability check for a bare definition prefix
  canNormalizeDefinitionId,
  // Resolvability check without normalizing
  canNormalizeRecordId,
  // Imperative prefix canonicalization (static tier + dynamic map)
  getNormalizedDefinitionId,
  // Imperative (reads store state — use from callbacks/non-hook contexts)
  getNormalizedRecordId,
  // Canonicalize-or-null for drain/flush loops (single parse)
  tryNormalizeRecordId,
  // Hook variant for a bare definition prefix
  useNormalizedDefinitionId,
  // Hook (recomputes when prefix mappings change)
  useNormalizedRecordId,
  // Plural hook
  useNormalizedRecordIds,
  // Reactivity primitive: bumps exactly when prefix mappings change
  usePrefixEpoch,
} from './normalize-record-id'
