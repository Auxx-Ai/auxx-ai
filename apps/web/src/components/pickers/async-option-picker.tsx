// apps/web/src/components/pickers/async-option-picker.tsx
'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { ItemsListView } from '~/components/ui/items-list-view'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useDebouncedValue } from '~/hooks/use-debounced-value'

export interface AsyncOptionPickerProps {
  /**
   * Async resolver. Called on open and on each debounced keystroke with the live
   * search string (`''` on open). Mutually exclusive with `staticOptions` —
   * `staticOptions` short-circuits and disables internal fetching.
   */
  loadOptions?: (query: string) => Promise<SelectOption[]>

  /**
   * Pre-resolved options. When provided, the picker renders these and filters
   * them client-side (via `MultiSelectPicker`); `loadOptions` is ignored. Pair
   * with `isLoading` when the options are themselves loaded externally.
   */
  staticOptions?: SelectOption[]

  /** External loading flag, for `staticOptions` mode (e.g. a tRPC query in flight). */
  isLoading?: boolean

  /** Selected value(s). */
  value: string | string[]

  /** Called with the next selection (always an array; single-select yields one). */
  onChange: (selected: string[]) => void

  /** Single (`false`, radio) or multi (`true`, checkbox). Default `false`. */
  multi?: boolean

  /** Debounce for `loadOptions` in ms. Default 250. */
  debounceMs?: number

  /** Trigger placeholder when nothing is selected. */
  placeholder?: string

  /** Search-input placeholder inside the popover. */
  searchPlaceholder?: string

  disabled?: boolean
  className?: string
  /** Extra className for the popover content (e.g. to scope it inside a panel). */
  popoverClassName?: string
  triggerProps?: PickerTriggerOptions

  /** Controlled open state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * AsyncOptionPicker
 *
 * One searchable, server-backed picker rendered host-side as the platform's
 * `MultiSelectPicker` (inside a `Popover`/`PickerTrigger`). The single contract
 * is `loadOptions(query) => Promise<SelectOption[]>` for server-driven search,
 * or `staticOptions` for the client-filtered/parity path.
 *
 * It owns debounce, loading/empty, stale-response dropping, and selected-value
 * label persistence so the chosen option keeps its label even after the option
 * list reloads to a page that no longer contains it (search-driven lists are
 * transient). See `plans/actions/11-async-option-picker.md`.
 */
export function AsyncOptionPicker({
  loadOptions,
  staticOptions,
  isLoading: externalLoading = false,
  value,
  onChange,
  multi = false,
  debounceMs = 250,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled = false,
  className,
  popoverClassName,
  triggerProps,
  open: controlledOpen,
  onOpenChange,
}: AsyncOptionPickerProps) {
  const normalizedValue = useMemo(
    () => (Array.isArray(value) ? value : value ? [value] : []),
    [value]
  )
  const isStatic = staticOptions !== undefined

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen

  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch] = useDebouncedValue(searchQuery, debounceMs)

  const [loaded, setLoaded] = useState<SelectOption[]>(staticOptions ?? [])
  const [asyncLoading, setAsyncLoading] = useState(false)
  // Persisted value → label so a selection survives the option list reloading.
  const [labelCache, setLabelCache] = useState<Record<string, string>>({})

  // Monotonic request id — only the latest in-flight resolution may apply.
  const latestReqRef = useRef(0)

  const setOpen = useCallback(
    (next: boolean) => {
      if (!next) setSearchQuery('')
      if (controlledOpen === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )

  // Static mode: mirror the externally-provided options.
  useEffect(() => {
    if (isStatic) setLoaded(staticOptions ?? [])
  }, [isStatic, staticOptions])

  // Async mode: resolve on open and on each debounced keystroke, dropping stale
  // responses so out-of-order results can't clobber a newer query.
  useEffect(() => {
    if (isStatic || !loadOptions || !open) return
    const reqId = ++latestReqRef.current
    setAsyncLoading(true)
    loadOptions(debouncedSearch)
      .then((opts) => {
        if (reqId === latestReqRef.current) setLoaded(opts)
      })
      .catch(() => {
        if (reqId === latestReqRef.current) setLoaded([])
      })
      .finally(() => {
        if (reqId === latestReqRef.current) setAsyncLoading(false)
      })
  }, [isStatic, loadOptions, open, debouncedSearch])

  // Cache labels of every option we see, for selected-value persistence.
  useEffect(() => {
    if (loaded.length === 0) return
    setLabelCache((prev) => {
      const next = { ...prev }
      for (const o of loaded) next[o.value] = o.label
      return next
    })
  }, [loaded])

  // Show selected values that aren't in the current list as extra rows (so they
  // stay checked + labeled), ahead of the resolved options.
  const options = useMemo<SelectOption[]>(() => {
    const present = new Set(loaded.map((o) => o.value))
    const extras = normalizedValue
      .filter((v) => !present.has(v))
      .map<SelectOption>((v) => ({ value: v, label: labelCache[v] ?? v }))
    return [...extras, ...loaded]
  }, [loaded, normalizedValue, labelCache])

  const handleChange = useCallback((selected: string[]) => onChange(selected), [onChange])

  const handleSelectSingle = useCallback(() => setOpen(false), [setOpen])

  const hasValue = normalizedValue.length > 0
  const isLoading = isStatic ? externalLoading : asyncLoading

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant={triggerProps?.variant ?? 'outline'}
          size={triggerProps?.size}
          hasValue={hasValue}
          placeholder={placeholder}
          showClear={triggerProps?.showClear ?? multi}
          hideIcon={triggerProps?.hideIcon}
          onClear={(e) => {
            e.stopPropagation()
            onChange([])
          }}
          asCombobox
          className={cn('h-auto min-h-8', className, triggerProps?.className)}>
          <ItemsListView
            items={normalizedValue}
            maxDisplay={3}
            renderItem={(v) => (
              <Badge variant='outline' className='text-xs truncate max-w-[180px]'>
                {labelCache[v] ?? v}
              </Badge>
            )}
          />
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          'p-0 min-w-[max(var(--radix-popover-trigger-width),18rem)]',
          popoverClassName
        )}
        align='start'>
        <MultiSelectPicker
          options={options}
          value={normalizedValue}
          onChange={handleChange}
          isLoading={isLoading}
          onSearchChange={setSearchQuery}
          canManage={false}
          canAdd={false}
          multi={multi}
          placeholder={searchPlaceholder}
          onSelectSingle={handleSelectSingle}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
