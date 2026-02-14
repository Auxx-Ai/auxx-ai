// packages/lib/src/mail-query/index.ts

// Client-side thread filtering
export {
  type FilterableThread,
  filterThreads,
  mapStatusSlugToClientFilter,
  type ThreadClientFilter,
  threadMatchesFilter,
} from './client'
// Context to conditions converter (frontend-safe)
export {
  buildConditionGroups,
  buildContextConditions,
  type ContextConditionParams,
} from './context-to-conditions'

// Search condition types
export type { FilterRef, SearchCondition } from './search-filters'
export {
  IsOperatorValue,
  parseSearchQuery,
  SearchOperator,
  type SearchToken,
} from './search-query-parser'

// NOTE: condition-query-builder.ts and draft-condition-builder.ts are server-only (uses drizzle/database)
// Import directly from '@auxx/lib/mail-query/condition-query-builder' or '@auxx/lib/mail-query/draft-condition-builder' in server code
