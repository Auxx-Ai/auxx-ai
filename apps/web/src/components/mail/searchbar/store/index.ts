// apps/web/src/components/mail/searchbar/store/index.ts

export {
  useSearchStore,
  selectHasActiveFilters,
  selectActiveFilterCount,
  selectDisplayText,
  buildFilterChips,
  selectFilterChipsRaw,
  EMPTY_CHIPS,
  type FilterChip,
  type EditingFilter,
} from './search-store'

export {
  useFilterChips,
  useSearchActions,
  useSearchUIState,
  useSearchStatus,
  useRecentSearches,
  useSearchContext,
  useSearchFilters,
} from './search-selectors'
