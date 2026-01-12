// apps/web/src/components/resources/utils/index.ts

export {
  // Pure function (requires resource object)
  getResourceLink,
  // Hook (auto-fetches resource from provider)
  useResourceLink,
} from './get-resource-link'
export type { GetResourceLinkOptions } from './get-resource-link'
