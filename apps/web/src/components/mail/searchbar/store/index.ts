// apps/web/src/components/mail/searchbar/store/index.ts

export {
  useFilterChips,
  useRecentSearches,
  useSearchActions,
  useSearchConditions,
  useSearchContext,
  useSearchFilters,
  useSearchStatus,
  useSearchUIState,
} from './search-selectors'
export {
  buildFilterChips,
  type EditingCondition,
  EMPTY_CHIPS,
  EMPTY_CONDITIONS,
  type FilterChip,
  type FilterRef,
  // Types
  type SearchCondition,
  selectActiveFilterCount,
  selectConditionByFieldId,
  selectConditionCount,
  selectDisplayText,
  selectFilterChipsRaw,
  selectHasActiveConditions,
  // Legacy aliases
  selectHasActiveFilters,
  selectHasNonDefaultScope,
  useSearchStore,
} from './search-store'
