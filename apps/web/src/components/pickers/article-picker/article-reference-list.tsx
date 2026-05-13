// apps/web/src/components/pickers/article-picker/article-reference-list.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandPlaceholder,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RecordItem } from '~/components/pickers/record-picker/record-item'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import type { SharedPickerContentProps } from '../types'

export interface ArticleReferenceListProps extends SharedPickerContentProps {}

/**
 * Flat single-list search component for the ReferencePicker Articles tab.
 * Backed by `api.record.search({ entityDefinitionId: 'article', ... })`.
 */
export function ArticleReferenceList({
  value,
  onChange,
  multi = false,
  onSelectSingle,
  externalSearch,
  showInput = true,
  onCaptureChange,
  placeholder = 'Search articles...',
  disabled = false,
  className,
}: ArticleReferenceListProps) {
  const [internalSearch, setInternalSearch] = useState('')
  const search = externalSearch ?? internalSearch
  const setSearch = externalSearch !== undefined ? () => {} : setInternalSearch
  const [debouncedSearch] = useDebouncedValue(search, 200)

  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  const { data, isLoading: isSearching } = api.record.search.useQuery(
    { entityDefinitionId: 'article', query: debouncedSearch, limit: !showInput ? 8 : 20 },
    {
      // In external-search (mention) mode, always fire so the empty-query state
      // shows recent articles instead of a "Type to search" prompt.
      enabled: !showInput || debouncedSearch.trim().length > 0,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  )

  const items = useMemo(() => data?.items ?? [], [data])

  const isSelected = useCallback((id: RecordId) => value.includes(id), [value])

  const handleToggle = useCallback(
    (recordId: RecordId) => {
      if (multi) {
        const exists = isSelected(recordId)
        onChange(exists ? value.filter((v) => v !== recordId) : [...value, recordId])
      } else {
        onChange([recordId])
        onSelectSingle?.(recordId)
      }
    },
    [multi, value, onChange, isSelected, onSelectSingle]
  )

  const isDebouncePending = search !== debouncedSearch
  const showPlaceholder =
    !showInput &&
    search.trim().length > 0 &&
    (isSearching || isDebouncePending) &&
    items.length === 0
  const showEmpty = !showPlaceholder && !isSearching && items.length === 0 && debouncedSearch.trim()
  const showEmptyInitial =
    !showInput && !isSearching && items.length === 0 && !debouncedSearch.trim()

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      {showInput && (
        <CommandInput
          placeholder={placeholder}
          value={search}
          onValueChange={setSearch}
          disabled={disabled}
          loading={isSearching}
        />
      )}
      <CommandList>
        {showPlaceholder && <CommandPlaceholder>Searching...</CommandPlaceholder>}
        {showEmpty && <CommandPlaceholder>No articles found</CommandPlaceholder>}
        {showEmptyInitial && <CommandPlaceholder>No articles yet</CommandPlaceholder>}
        {items.length > 0 && (
          <CommandGroup aria-label='Articles'>
            {items.map((item) => (
              <RecordItem
                key={item.recordId}
                item={item}
                isSelected={isSelected(item.recordId)}
                onToggle={handleToggle}
                multi={multi}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
