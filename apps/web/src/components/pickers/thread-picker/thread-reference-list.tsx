// apps/web/src/components/pickers/thread-picker/thread-reference-list.tsx

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
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
import { useThreadList } from '~/components/threads/hooks'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import type { SharedPickerContentProps } from '../types'

const EMPTY_FILTER: ConditionGroup[] = []

export interface ThreadReferenceListProps extends SharedPickerContentProps {}

/**
 * Flat single-list component for the ReferencePicker Messages tab.
 * Empty query → recent threads via useThreadList. Non-empty query → record.search.
 */
export function ThreadReferenceList({
  value,
  onChange,
  multi = false,
  onSelectSingle,
  externalSearch,
  showInput = true,
  onCaptureChange,
  placeholder = 'Search threads...',
  disabled = false,
  className,
}: ThreadReferenceListProps) {
  const [internalSearch, setInternalSearch] = useState('')
  const search = externalSearch ?? internalSearch
  const setSearch = externalSearch !== undefined ? () => {} : setInternalSearch
  const [debouncedSearch] = useDebouncedValue(search, 200)

  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Empty query → most recently active threads.
  const hasQuery = debouncedSearch.trim().length > 0
  const { threads, isLoading: isThreadListLoading } = useThreadList({
    filter: EMPTY_FILTER,
    sort: { field: 'lastMessageAt', direction: 'desc' },
    enabled: !hasQuery,
  })

  // Non-empty query → record.search scoped to thread.
  const { data: searchData, isLoading: isSearching } = api.record.search.useQuery(
    { entityDefinitionId: 'thread', query: debouncedSearch, limit: 20 },
    {
      enabled: hasQuery,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  )

  const items = useMemo(() => {
    if (hasQuery) return searchData?.items ?? []
    // Map ThreadMeta → RecordPickerItem-shaped row for RecordItem rendering.
    return threads.slice(0, 8).map((t) => ({
      id: t.id,
      recordId: `thread:${t.id}` as RecordId,
      displayName: t.subject || '(no subject)',
      secondaryInfo: undefined as string | undefined,
      avatarUrl: undefined,
      data: t as unknown as Record<string, unknown>,
      createdAt: t.firstMessageAt ?? t.lastMessageAt,
      updatedAt: t.lastMessageAt,
    }))
  }, [hasQuery, searchData, threads])

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

  const isLoading = hasQuery ? isSearching : isThreadListLoading
  const isDebouncePending = search !== debouncedSearch
  const showPlaceholder =
    !showInput && hasQuery && (isSearching || isDebouncePending) && items.length === 0
  const showEmpty = !showPlaceholder && !isLoading && items.length === 0

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      {showInput && (
        <CommandInput
          placeholder={placeholder}
          value={search}
          onValueChange={setSearch}
          disabled={disabled}
          loading={isLoading}
        />
      )}
      <CommandList>
        {showPlaceholder && <CommandPlaceholder>Searching...</CommandPlaceholder>}
        {showEmpty && (
          <CommandPlaceholder>
            {hasQuery ? 'No threads found' : 'No recent threads'}
          </CommandPlaceholder>
        )}
        {items.length > 0 && (
          <CommandGroup aria-label={hasQuery ? 'Threads' : 'Recent threads'}>
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
