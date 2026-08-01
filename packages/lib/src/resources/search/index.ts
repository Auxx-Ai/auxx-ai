// packages/lib/src/resources/search/index.ts

export {
  articleSearchColumns,
  articleSearchCursor,
  articleSearchPredicate,
  articleSearchRank,
} from './article-search-sql'
export {
  RECORD_SEARCH_COLUMNS_EI,
  recordSearchColumns,
  recordSearchColumnsAliased,
  recordSearchCursor,
  recordSearchNameScore,
  recordSearchPredicate,
  recordSearchRank,
  recordSearchTextScore,
} from './record-search-sql'
export {
  getSystemSearchBinding,
  hasSystemSearchBinding,
  type SystemSearchBinding,
} from './system-search-bindings'
