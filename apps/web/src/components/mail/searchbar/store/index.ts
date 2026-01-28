// apps/web/src/components/mail/searchbar/store/index.ts

export {
  useSearchStore,
  selectHasActiveConditions,
  selectConditionCount,
  selectDisplayText,
  selectConditionByFieldId,
  buildFilterChips,
  selectFilterChipsRaw,
  EMPTY_CHIPS,
  EMPTY_CONDITIONS,
  // Legacy aliases
  selectHasActiveFilters,
  selectActiveFilterCount,
  // Types
  type SearchCondition,
  type EditingCondition,
  type FilterChip,
  type FilterRef,
} from './search-store'

export {
  useFilterChips,
  useSearchConditions,
  useSearchActions,
  useSearchUIState,
  useSearchStatus,
  useRecentSearches,
  useSearchContext,
  useSearchFilters,
} from './search-selectors'
