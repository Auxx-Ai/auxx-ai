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
  onCaptureChange,
  placeholder = 'Search articles...',
  disabled = false,
  className,
}: ArticleReferenceListProps) {
  const [internalSearch, setInternalSearch] = useState('')
  const search = externalSearch ?? internalSearch
  const setSearch = externalSearch !== undefined ? () => {} : setInternalSearch
  const [debouncedSearch] = useDebouncedValue(search, 200)
  const useExternalSearch = externalSearch !== undefined

  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  const { data, isLoading: isSearching } = api.record.search.useQuery(
    { entityDefinitionId: 'article', query: debouncedSearch, limit: 20 },
    {
      enabled: debouncedSearch.trim().length > 0 || !useExternalSearch,
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
    useExternalSearch && search.trim().length > 0 && (isSearching || isDebouncePending)
  const showEmpty = !showPlaceholder && !isSearching && debouncedSearch.trim() && items.length === 0
  const showPromptEmpty = useExternalSearch && search.trim().length === 0

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      {!useExternalSearch && (
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
        {showPromptEmpty && <CommandPlaceholder>Type to search articles</CommandPlaceholder>}
        {showEmpty && <CommandPlaceholder>No articles found</CommandPlaceholder>}
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
