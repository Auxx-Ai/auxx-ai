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

// Structured search filters for the new searchbar architecture
export {
  type FilterRef,
  type SearchFilters,
  type ApiSearchFilter,
  hasActiveFilters,
  filtersToApiFilter,
} from './search-filters'

// NOTE: condition-query-builder.ts is server-only (uses drizzle/database)
// Import directly from '@auxx/lib/mail-query/condition-query-builder' in server code
