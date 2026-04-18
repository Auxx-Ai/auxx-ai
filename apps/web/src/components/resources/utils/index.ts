// apps/web/src/components/resources/utils/index.ts

export type { GetRecordLinkOptions } from './get-record-link'
export {
  // Pure function (requires resource object)
  getRecordLink,
  // Hook (auto-fetches resource from provider)
  useRecordLink,
} from './get-record-link'
export {
  // Imperative (reads store state — use from callbacks/non-hook contexts)
  getNormalizedRecordId,
  // Pure function (requires resource object)
  normalizeRecordId,
  // Hook (resolves resource from the store)
  useNormalizedRecordId,
} from './normalize-record-id'
