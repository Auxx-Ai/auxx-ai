// packages/lib/src/mail-query/index.ts

export {
  SearchOperator,
  IsOperatorValue,
  parseSearchQuery,
  type SearchToken,
} from './search-query-parser'

// Client-side thread filtering
export {
  type ThreadClientFilter,
  type FilterableThread,
  mapStatusSlugToClientFilter,
  threadMatchesFilter,
  filterThreads,
} from './client'

// Search condition types
export { type FilterRef, type SearchCondition } from './search-filters'

// Context to conditions converter (frontend-safe)
export {
  buildContextConditions,
  buildConditionGroups,
  type ContextConditionParams,
} from './context-to-conditions'

// NOTE: condition-query-builder.ts is server-only (uses drizzle/database)
// Import directly from '@auxx/lib/mail-query/condition-query-builder' in server code
