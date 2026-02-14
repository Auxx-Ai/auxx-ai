// apps/web/src/components/resources/utils/index.ts

export type { GetRecordLinkOptions } from './get-record-link'
export {
  // Pure function (requires resource object)
  getRecordLink,
  // Hook (auto-fetches resource from provider)
  useRecordLink,
} from './get-record-link'
