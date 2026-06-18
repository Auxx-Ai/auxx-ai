// apps/web/src/components/kbar/pages/search.tsx
'use client'

import { getDefinitionId, type RecordId, type RecordPickerItem } from '@auxx/lib/resources/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandPlaceholder,
} from '@auxx/ui/components/command'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { keepPreviousData } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useMemo, useRef, useState } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { recordHref } from '../record-href'
import { useCommandPaletteStore } from '../store'
import { RecordPreview } from './record-preview'

/**
 * Record search page: a debounced `record.search` across every visible entity,
 * rendered as a results list grouped by entity type. Fires on open with an empty
 * query (→ recent records) so the list is never blank. Arrowing/hover moves the
 * cmdk highlight (drives `⌘K` → actions) and Enter opens the highlighted record.
 * The right pane previews the highlighted row on every change except hover (so the
 * auto-selected first row previews immediately); the footer's "Open record" button
 * opens the previewed record.
 */
export function SearchPage() {
  const [query, setQuery] = useState('')
  const [activeValue, setActiveValue] = useState('')
  // The previewed record is click-driven (not hover/arrow) so the right pane
  // stays put while the keyboard navigates the list.
  const [previewItem, setPreviewItem] = useState<RecordPickerItem | null>(null)
  const [debouncedQuery] = useDebouncedValue(query, 200)
  const router = useRouter()

  // True only while the active row is changing due to pointer hover — we then
  // skip the preview. Any keydown and the initial auto-select count as non-hover,
  // so they DO preview. Set in capture phase to beat cmdk's active change.
  const hoverActiveRef = useRef(false)

  const { resources } = useResources()
  const getResourceById = useResourceStore((s) => s.getResourceById)
  const setSearchActive = useCommandPaletteStore((s) => s.setSearchActive)
  const close = useCommandPaletteStore((s) => s.close)

  // All visible entity definitions — the search scope.
  const entityDefinitionIds = useMemo(
    () => resources.filter((r) => r.isVisible).map((r) => r.id),
    [resources]
  )

  const { data, isFetching } = api.record.search.useQuery(
    { query: debouncedQuery, entityDefinitionIds, limit: 15 },
    {
      enabled: entityDefinitionIds.length > 0,
      placeholderData: keepPreviousData,
      staleTime: 30_000,
    }
  )

  const items = useMemo(() => data?.items ?? [], [data])

  // Group results by owning entity, preserving server order.
  const groups = useMemo(() => {
    const map = new Map<string, RecordPickerItem[]>()
    for (const item of items) {
      const defId = getDefinitionId(item.recordId)
      const bucket = map.get(defId)
      if (bucket) bucket.push(item)
      else map.set(defId, [item])
    }
    return [...map.entries()]
  }, [items])

  const itemByRecordId = useMemo(() => {
    const map = new Map<string, RecordPickerItem>()
    for (const item of items) map.set(item.recordId, item)
    return map
  }, [items])

  // Fall back to the first result so the pane is never empty (initial open) and
  // never shows a record that dropped out of the latest results (query change).
  const preview =
    previewItem && itemByRecordId.has(previewItem.recordId) ? previewItem : (items[0] ?? null)

  /**
   * Mirror cmdk's highlighted row into the store (drives ⌘K → actions) and preview
   * it — unless the change came from hover, which only moves the highlight.
   */
  const handleActiveChange = (value: string) => {
    setActiveValue(value)
    const item = itemByRecordId.get(value) ?? null
    setSearchActive(
      item
        ? {
            recordId: item.recordId,
            entityDefinitionId: getDefinitionId(item.recordId),
            displayName: item.displayName,
          }
        : null
    )
    if (!hoverActiveRef.current) setPreviewItem(item)
  }

  const openRecord = (item: RecordPickerItem) => {
    const href = recordHref(item.recordId as RecordId, getResourceById)
    if (href) {
      router.push(href)
      close()
    }
  }

  // Any keypress means the next active change is keyboard-driven, not hover —
  // capture phase so the flag is cleared before cmdk emits the active change.
  const handleKeyDownCapture = () => {
    hoverActiveRef.current = false
  }

  // Enter opens the keyboard-highlighted row. (cmdk's own Enter handler is
  // suppressed by the DialogContent capture-phase preventDefault, so we open the
  // active record ourselves; click is reserved for previewing, not opening.)
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    const item = itemByRecordId.get(activeValue)
    if (item) {
      e.preventDefault()
      openRecord(item)
    }
  }

  return (
    <Command
      shouldFilter={false}
      value={activeValue}
      onValueChange={handleActiveChange}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
      onPointerMoveCapture={() => {
        hoverActiveRef.current = true
      }}
      className='flex min-h-0 flex-col'>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        autoFocus
        loading={isFetching}
        placeholder='Search records…'
      />
      <div className='grid h-[min(300px,55vh)] grid-cols-1 md:grid-cols-2 max-sm:h-auto max-sm:min-h-0 max-sm:flex-1'>
        <div className='flex min-w-0 flex-col overflow-hidden border-border/50 md:border-r dark:border-[#323842]/80'>
          <CommandList className='min-w-0' scrollAreaClassName='h-full max-h-none'>
            {isFetching && items.length === 0 && <CommandLoading>Searching…</CommandLoading>}
            {!isFetching && items.length === 0 && (
              <CommandPlaceholder>No records found.</CommandPlaceholder>
            )}

            {groups.map(([defId, groupItems]) => {
              const resource = getResourceById(defId)
              return (
                <CommandGroup
                  key={defId}
                  heading={resource?.plural ?? resource?.label ?? 'Records'}>
                  {groupItems.map((item) => (
                    <CommandItem
                      key={item.recordId}
                      value={item.recordId}
                      onSelect={() => setPreviewItem(item)}
                      className='group flex items-center gap-2'>
                      <RecordIcon
                        avatarUrl={item.avatarUrl}
                        iconId={item.iconId ?? resource?.icon ?? 'circle'}
                        color='gray'
                        size='sm'
                        inverse
                        className='-ms-0.5 inset-shadow-xs inset-shadow-black/20'
                      />
                      <div className='flex min-w-0 flex-1 items-center overflow-hidden'>
                        <span className='truncate'>{item.displayName}</span>
                        {item.secondaryInfo && (
                          <span className='truncate text-xs text-muted-foreground [flex-shrink:9999]'>
                            {'  '}
                            {item.secondaryInfo}
                          </span>
                        )}
                      </div>
                      {resource && (
                        <Badge
                          variant={(resource.color || 'gray') as Variant}
                          size='xs'
                          className='me-2 shrink-0'>
                          {resource.label}
                        </Badge>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </div>

        <RecordPreview recordId={preview?.recordId ?? null} item={preview} />
      </div>

      <div className='flex h-11 items-center gap-4 border-t border-border/50 px-3 text-xs text-muted-foreground dark:border-[#323842]/80'>
        <span className='flex items-center gap-1'>
          <KbdGroup variant='ghost' size='sm'>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </KbdGroup>
          Navigate
        </span>
        <span className='flex items-center gap-1'>
          <KbdGroup variant='ghost' size='sm'>
            <Kbd shortcut='cmd' />
            <Kbd>K</Kbd>
          </KbdGroup>
          Actions
        </span>
        {preview && (
          <Button
            variant='default'
            size='xs'
            className='ml-auto'
            onClick={() => openRecord(preview)}>
            Open record
            <Kbd shortcut='enter' variant='default' size='sm' />
          </Button>
        )}
      </div>
    </Command>
  )
}
