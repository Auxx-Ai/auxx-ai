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
