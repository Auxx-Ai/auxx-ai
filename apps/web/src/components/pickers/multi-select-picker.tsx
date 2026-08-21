// apps/web/src/components/pickers/multi-select-picker.tsx
'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import type { SelectOption, SelectOptionColor } from '@auxx/types/custom-field'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils/generateId'
import { Check, LayoutGrid, Loader2, Plus, Settings, Tags, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OptionColorPicker } from '~/components/custom-fields/ui/option-color-picker'
import { getNextOptionColor } from '~/components/custom-fields/utils/get-next-option-color'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/**
 * Usage count for one option, summed over BOTH keyspaces (`id` and `value`).
 *
 * The server's delete cascade diffs the option list with `buildOptionIndex`, which
 * registers an option under `id` AND `value`, so values stored under either key are
 * what a delete destroys. Counting only one would understate the blast radius.
 *
 * @returns the count, or `undefined` when no counts are loaded (unknown, not zero)
 */
function sumOptionUsage(
  counts: Record<string, number> | undefined,
  option: Pick<SelectOption, 'id' | 'value'>
): number | undefined {
  if (!counts) return undefined
  const byValue = counts[option.value] ?? 0
  const byId = option.id && option.id !== option.value ? (counts[option.id] ?? 0) : 0
  return byValue + byId
}

/** "1 record" / "47 records" — used in the delete confirm and the inline hint. */
function recordsPhrase(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`
}

/**
 * Props for the MultiSelectPicker component
 */
export interface MultiSelectPickerProps {
  /** Available options to select from */
  options: SelectOption[]

  /** Currently selected option value(s) */
  value: string | string[]

  /** Called when selection changes */
  onChange: (selected: string[]) => void

  /** Called when options are modified (create/edit/delete) */
  onOptionsChange?: (options: SelectOption[]) => void

  /** Placeholder text for search input (default: "Search...") */
  placeholder?: string

  /** Label for manage button (default: "Manage options") */
  manageLabel?: string

  /** Show "Manage options" button (default: true) */
  canManage?: boolean

  /** Allow creating new options (default: true) */
  canAdd?: boolean

  /** Multi-select mode: true = checkbox, false = radio button (default: true) */
  multi?: boolean

  /** Called after selection in single-select mode (for close-on-select behavior) */
  onSelectSingle?: (value: string) => void

  /** Callback when arrow key capture state changes (for parent navigation) */
  onCaptureChange?: (capturing: boolean) => void

  /** Disabled state */
  disabled?: boolean

  /** Additional className for Command wrapper */
  className?: string

  /** Loading state - shows spinner instead of options list */
  isLoading?: boolean

  /** Callback when search input changes (for external search handling) */
  onSearchChange?: (value: string) => void

  /** Callback when "Create new" is clicked (for complex creation flows via dialog) */
  onCreate?: () => void

  /** Label for create button (default: "Create new") */
  createLabel?: string

  /** When true, created options use the label text as value instead of a UUID */
  useValueAsLabel?: boolean

  /** Called when an option is clicked in manage mode (overrides inline edit) */
  onEdit?: (value: string) => void

  /** Callback for a secondary action button (e.g., "Browse prompts") */
  onBrowse?: () => void

  /** Label for browse button (default: "Browse all") */
  browseLabel?: string

  /** Render a per-row secondary action (e.g., a "favorite" star). Rendered before the selection indicator. */
  renderItemAction?: (opt: SelectOption) => React.ReactNode

  /**
   * Partition options into headed sections. Returns the group id an option
   * belongs to; options sharing an id render under one `CommandGroup`. Absent ⇒
   * a single ungrouped list (default). Search still filters across every group;
   * groups left empty after filtering are dropped. Selection, create, and manage
   * are unaffected — they remain keyed by option `value`.
   */
  groupBy?: (opt: SelectOption) => string

  /**
   * Group ordering + headings for {@link groupBy}. Groups render in this order;
   * `heading` is a node, so callers can render an icon + label (e.g. `<AppIcon>`).
   * Any group id produced by `groupBy` but missing here is appended after these,
   * in first-seen order, with its raw id as the heading.
   */
  groups?: Array<{ id: string; heading?: React.ReactNode }>

  /**
   * The field these options belong to. When set, manage-mode deletes are gated by a
   * confirm carrying the option's real usage count, because the server cascades an
   * option delete to every record that stores it.
   *
   * Optional on purpose: the picker is also used with no field behind it (workflow
   * node inputs, the webhook topic picker, participant pickers). Those omit it and
   * keep the plain immediate delete with no dialog.
   */
  resourceFieldId?: ResourceFieldId
}

/**
 * MultiSelectPicker
 * Agnostic command-based picker with create, edit, and delete functionality.
 * Supports both multi-select (checkbox) and single-select (radio) modes.
 */
export function MultiSelectPicker({
  options,
  value,
  onChange,
  onOptionsChange,
  placeholder = 'Search...',
  manageLabel = 'Manage options',
  canManage = true,
  canAdd = true,
  multi = true,
  onSelectSingle,
  onCaptureChange,
  disabled = false,
  className,
  isLoading = false,
  onSearchChange,
  onCreate,
  createLabel = 'Create new',
  useValueAsLabel = false,
  onEdit,
  onBrowse,
  browseLabel = 'Browse all',
  renderItemAction,
  groupBy,
  groups,
  resourceFieldId,
}: MultiSelectPickerProps) {
  const editInputRef = useRef<HTMLInputElement>(null)

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Local options state (for optimistic UI when editing)
  const [localOptions, setLocalOptions] = useState<SelectOption[]>(options)

  // Sync when props change
  useEffect(() => {
    setLocalOptions(options)
  }, [options])

  // Local selected state
  const [localSelected, setLocalSelected] = useState<string[]>(() => {
    return Array.isArray(value) ? value : value ? [value] : []
  })

  // Sync when props change
  useEffect(() => {
    const newSelected = Array.isArray(value) ? value : value ? [value] : []
    setLocalSelected(newSelected)
  }, [value])

  // UI state
  const [searchValue, setSearchValue] = useState('')
  const [isManageMode, setIsManageMode] = useState(false)
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null)
  const [editInputValue, setEditInputValue] = useState('')
  const [editColor, setEditColor] = useState<SelectOptionColor | undefined>(undefined)

  const [confirm, ConfirmDialog] = useConfirm()

  // One query per manage session, never one per delete click: the endpoint returns a
  // count for every option of the field at once, so the rows can show it inline too.
  const usageQuery = api.customField.countOptionUsage.useQuery(
    { resourceFieldId: resourceFieldId ?? ('' as ResourceFieldId) },
    { enabled: Boolean(resourceFieldId) && isManageMode }
  )
  const usageCounts = usageQuery.data
  const usageError = usageQuery.error

  useEffect(() => {
    // A member without def-administration rights gets a 403 from this query. They can't
    // delete an option either (`customField.update` is gated the same way), so the denial
    // is expected here and not worth a toast.
    const code = usageError?.data?.code
    if (usageError && code !== 'FORBIDDEN' && code !== 'UNAUTHORIZED') {
      toastError({ title: 'Error loading option usage', description: usageError.message })
    }
  }, [usageError])

  // Filter options by search value
  const filteredOptions = useMemo(() => {
    if (!searchValue.trim()) return localOptions
    const search = searchValue.toLowerCase()
    return localOptions.filter((opt) => opt.label.toLowerCase().includes(search))
  }, [localOptions, searchValue])

  // Partition filtered options into ordered, headed sections when `groupBy` is
  // set; `null` keeps the single ungrouped list. Group order follows `groups`,
  // then any ids `groupBy` produces that `groups` omits (first-seen). Empty
  // groups (all members filtered out by search) are dropped.
  const groupedOptions = useMemo(() => {
    if (!groupBy) return null
    const headingById = new Map((groups ?? []).map((g) => [g.id, g.heading]))
    const order: string[] = (groups ?? []).map((g) => g.id)
    const itemsById = new Map<string, SelectOption[]>()
    for (const opt of filteredOptions) {
      const id = groupBy(opt)
      if (!itemsById.has(id)) {
        itemsById.set(id, [])
        if (!headingById.has(id)) order.push(id)
      }
      itemsById.get(id)?.push(opt)
    }
    return order
      .filter((id) => itemsById.has(id))
      .map((id) => ({ id, heading: headingById.get(id) ?? id, items: itemsById.get(id) ?? [] }))
  }, [groupBy, groups, filteredOptions])

  // Check if search value matches an existing label (for hiding "Create" option)
  const searchMatchesExisting = useMemo(() => {
    if (!searchValue.trim()) return true
    const search = searchValue.toLowerCase().trim()
    return localOptions.some((opt) => opt.label.toLowerCase() === search)
  }, [localOptions, searchValue])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingOptionId && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingOptionId])

  /**
   * Updates options - local state + callback to parent
   */
  const updateOptions = useCallback(
    (newOptions: SelectOption[]) => {
      setLocalOptions(newOptions)
      onOptionsChange?.(newOptions)
    },
    [onOptionsChange]
  )

  /**
   * Updates selected values - local state + callback to parent
   */
  const updateSelected = useCallback(
    (newSelected: string[]) => {
      setLocalSelected(newSelected)
      onChange(newSelected)
    },
    [onChange]
  )

  /**
   * Handle option selection
   */
  const handleSelect = useCallback(
    (optValue: string) => {
      if (multi) {
        // Toggle in array
        const newSelected = localSelected.includes(optValue)
          ? localSelected.filter((v) => v !== optValue)
          : [...localSelected, optValue]
        updateSelected(newSelected)
      } else {
        // Single select - replace and notify
        updateSelected([optValue])
        onSelectSingle?.(optValue)
      }
    },
    [multi, localSelected, updateSelected, onSelectSingle]
  )

  /**
   * Create a new option with the current search value
   */
  const createOption = useCallback(() => {
    if (!canAdd) return
    const newLabel = searchValue.trim()
    if (!newLabel) return

    // Check for duplicate label (case insensitive)
    if (localOptions.some((opt) => opt.label.toLowerCase() === newLabel.toLowerCase())) {
      setSearchValue('')
      return
    }

    // Use label as value when useValueAsLabel is true, otherwise generate UUID
    const newValue = useValueAsLabel ? newLabel : generateId()
    // Auto-assign a colour the same way the field form does, so an option typed on a
    // record isn't left colourless (and therefore dot-less) next to authored ones.
    const newOption: SelectOption = {
      label: newLabel,
      value: newValue,
      color: getNextOptionColor(
        localOptions.map((o) => o.color).filter(Boolean) as SelectOptionColor[]
      ),
    }

    // Update options and auto-select the new option. In single-select mode,
    // replace the selection (mirror `handleSelect`) so a pre-existing value
    // isn't left behind as `[old, new][0]`; in multi mode, append.
    updateOptions([...localOptions, newOption])
    updateSelected(multi ? [...localSelected, newValue] : [newValue])
    if (!multi) onSelectSingle?.(newValue)

    setSearchValue('')
  }, [
    canAdd,
    searchValue,
    localOptions,
    localSelected,
    multi,
    onSelectSingle,
    updateOptions,
    updateSelected,
    useValueAsLabel,
  ])

  /**
   * Delete an option.
   *
   * When a field backs the picker the server cascades the delete to every stored
   * value, so anything with usage — or whose count could not be read — is confirmed
   * first. Zero usages deletes straight away.
   */
  const deleteOption = useCallback(
    async (optValue: string) => {
      const option = localOptions.find((opt) => opt.value === optValue)

      if (resourceFieldId) {
        const used = sumOptionUsage(usageCounts, option ?? { value: optValue })
        // `undefined` means the counts never arrived (still loading, or the query
        // failed). Warn anyway — it just can't name a number.
        if (used === undefined || used > 0) {
          const confirmed = await confirm({
            title: `Delete "${option?.label || optValue}"?`,
            description:
              used === undefined
                ? "It will be removed from every record that uses it. This can't be undone."
                : `It's used on ${recordsPhrase(used)} and will be removed from all of them. This can't be undone.`,
            confirmText: 'Delete',
            destructive: true,
          })
          if (!confirmed) return
        }
      }

      const newOptions = localOptions.filter((opt) => opt.value !== optValue)
      updateOptions(newOptions)

      // Also remove from selection if selected. The server cascade covers every other
      // record; this keeps the open record's UI correct before the refetch lands.
      if (localSelected.includes(optValue)) {
        updateSelected(localSelected.filter((v) => v !== optValue))
      }
    },
    [
      localOptions,
      localSelected,
      updateOptions,
      updateSelected,
      resourceFieldId,
      usageCounts,
      confirm,
    ]
  )

  /**
   * Start editing an option
   */
  const startEdit = useCallback(
    (optValue: string) => {
      const opt = localOptions.find((o) => o.value === optValue)
      if (opt) {
        setEditingOptionId(optValue)
        setEditInputValue(opt.label)
        setEditColor(opt.color)
      }
    },
    [localOptions]
  )

  /**
   * Cancel editing
   */
  const cancelEdit = useCallback(() => {
    setEditingOptionId(null)
    setEditInputValue('')
    setEditColor(undefined)
  }, [])

  /**
   * Save the edited option's label and colour.
   *
   * Writes ONLY `label` and `color`. `value` is the key every `FieldValue` of this
   * option stores, and `updateCustomField` diffs the option list and cascades a delete
   * to the values of any key that disappears — so rewriting `value` on a rename would
   * destroy every record's value. An option's identity is minted at create time and
   * never changes.
   */
  const saveEdit = useCallback(() => {
    if (!editingOptionId || !editInputValue.trim()) {
      cancelEdit()
      return
    }

    const newLabel = editInputValue.trim()

    // Check for duplicate label (excluding the option being edited)
    if (
      localOptions.some(
        (opt) => opt.value !== editingOptionId && opt.label.toLowerCase() === newLabel.toLowerCase()
      )
    ) {
      cancelEdit()
      return
    }

    // Update only the label and colour, keep every other property (`value` above all)
    const newOptions = localOptions.map((opt) =>
      opt.value === editingOptionId ? { ...opt, label: newLabel, color: editColor } : opt
    )

    updateOptions(newOptions)
    cancelEdit()
  }, [editingOptionId, editInputValue, editColor, localOptions, updateOptions, cancelEdit])

  /**
   * Handle key events in edit input
   */
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEdit()
      }
    },
    [saveEdit, cancelEdit]
  )

  /**
   * Toggle manage mode
   */
  const toggleManageMode = useCallback(() => {
    if (isManageMode && editingOptionId) {
      cancelEdit()
    }
    setIsManageMode(!isManageMode)
  }, [isManageMode, editingOptionId, cancelEdit])

  // One option row. Extracted so the grouped and ungrouped lists share identical
  // item markup — only the surrounding `CommandGroup`(s) differ.
  const renderOption = (opt: SelectOption) => {
    const usage = isManageMode ? sumOptionUsage(usageCounts, opt) : undefined
    return (
      <CommandItem
        key={opt.value}
        value={opt.value}
        onSelect={() => {
          if (isManageMode) {
            if (onEdit) {
              onEdit(opt.value)
            } else {
              startEdit(opt.value)
            }
          } else {
            handleSelect(opt.value)
          }
        }}
        disabled={disabled}
        className={cn(
          'group/item cursor-pointer h-7',
          isManageMode && 'py-0 pe-1',
          editingOptionId === opt.value && 'bg-primary-200'
        )}>
        <div className='flex items-center justify-between w-full'>
          <div className='flex items-center gap-2'>
            {/* Selection indicator (checkbox/radio) or manage icon */}

            {/* Avatar + icon fallback (record pickers carry avatarUrl) */}
            {opt.avatarUrl ? (
              <RecordIcon
                avatarUrl={opt.avatarUrl}
                iconId={opt.icon || 'circle'}
                color={opt.color ?? 'gray'}
                size='sm'
              />
            ) : (
              <>
                {/* Icon (if option has icon) */}
                {opt.icon && (
                  <EntityIcon
                    iconId={opt.icon}
                    size='sm'
                    {...(opt.color?.startsWith('#')
                      ? { style: { color: opt.color } }
                      : { color: opt.color ?? 'gray' })}
                  />
                )}

                {/* Color dot (if option has color but no icon) */}
                {opt.color && !opt.icon && (
                  <div
                    className={cn(
                      'size-3 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10',
                      getColorSwatch(opt.color)
                    )}
                  />
                )}
              </>
            )}

            {/* Option label */}
            <span className='truncate'>{opt.label}</span>
          </div>
          <div className='flex items-center gap-1 shrink-0'>
            {/* Per-row secondary action (e.g., favorite star) */}
            {!isManageMode && renderItemAction && renderItemAction(opt)}
            {/* Edit button on hover (normal mode only) */}
            {!isManageMode && onEdit && (
              <button
                type='button'
                disabled={disabled}
                className='hidden group-hover/item:flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-primary-200'
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(opt.value)
                }}>
                <Settings className='size-3' />
              </button>
            )}
            {usage !== undefined && (
              <span
                className='text-[10px] text-muted-foreground tabular-nums'
                title={`Used on ${recordsPhrase(usage)}`}>
                {usage}
              </span>
            )}
            <div className='flex items-center justify-center'>
              {isManageMode ? (
                <span className='bg-secondary rounded-sm py-[1px] px-[3px] text-[10px]'>
                  Click to edit
                </span>
              ) : multi ? (
                <Checkbox
                  checked={localSelected.includes(opt.value)}
                  className='pointer-events-none'
                />
              ) : (
                localSelected.includes(opt.value) && (
                  <div className='rounded-full size-4 bg-info flex items-center justify-center border border-blue-800'>
                    <Check className='size-2.5! text-white' strokeWidth={4} />
                  </div>
                )
              )}
            </div>
            {/* Delete button in manage mode */}
            {isManageMode && (
              <Button
                variant='destructive-hover'
                type='button'
                size='icon-xs'
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteOption(opt.value)
                }}>
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
      </CommandItem>
    )
  }

  return (
    <>
      <Command shouldFilter={false} className={cn('rounded-lg', className)}>
        {/* Search/Edit Input Area */}
        {editingOptionId ? (
          <div className='flex items-center border-b border-border/50 ps-1.5 pe-1'>
            {/* The colour dropdown portals, and React portal events bubble to the REACT
                parent — which here is cmdk's <Command>, whose root `onKeyDown` moves the
                command selection on arrows and fires the highlighted item on Enter. Swallow
                keydowns at this wrapper so the colour menu's own keys stay inside it.
                Radix closes on Escape via a native document listener, so that still works. */}
            <div className='me-1 shrink-0' onKeyDown={(e) => e.stopPropagation()}>
              <OptionColorPicker value={editColor} onChange={setEditColor} disabled={disabled} />
            </div>
            <input
              ref={editInputRef}
              className='flex h-8 w-full rounded-md bg-transparent py-1 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
              value={editInputValue}
              onChange={(e) => setEditInputValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              placeholder='Edit option name...'
              disabled={disabled}
            />
            <button
              type='button'
              onClick={saveEdit}
              disabled={disabled}
              className='rounded-full cursor-default flex items-center justify-center hover:bg-good-100 hover:text-good-500 size-5 shrink-0 mx-0.5'>
              <Check className='size-3' />
            </button>
            <button
              type='button'
              onClick={cancelEdit}
              disabled={disabled}
              className='rounded-full cursor-default flex items-center justify-center hover:bg-bad-100 hover:text-bad-500 size-5 shrink-0'>
              <X className='size-3' />
            </button>
          </div>
        ) : (
          <CommandInput
            placeholder={placeholder}
            value={searchValue}
            onValueChange={(val) => {
              setSearchValue(val)
              onSearchChange?.(val)
            }}
            disabled={disabled}
          />
        )}

        <CommandList>
          {/* Loading state */}
          {isLoading ? (
            <div className='flex items-center justify-center py-6'>
              <Loader2 className='size-4 animate-spin' />
            </div>
          ) : (
            <>
              {/* Create option */}
              {canAdd && searchValue.trim() && !searchMatchesExisting && (
                <>
                  <CommandGroup>
                    <CommandItem
                      onSelect={createOption}
                      className='cursor-pointer h-7'
                      disabled={disabled}>
                      <Plus className='text-muted-foreground' />
                      <span>
                        Create "<span className='font-medium'>{searchValue.trim()}</span>"
                      </span>
                    </CommandItem>
                  </CommandGroup>
                  <div className='-mx-1 h-px bg-border/50' />
                </>
              )}

              {/* Options List */}
              {filteredOptions.length === 0 && !searchValue.trim() && (
                <CommandEmpty>No options yet. Type to create one.</CommandEmpty>
              )}
              {filteredOptions.length > 0 &&
                (groupedOptions ? (
                  groupedOptions.map((group) => (
                    <CommandGroup key={group.id} heading={group.heading}>
                      {group.items.map(renderOption)}
                    </CommandGroup>
                  ))
                ) : (
                  <CommandGroup>{filteredOptions.map(renderOption)}</CommandGroup>
                ))}
            </>
          )}
        </CommandList>

        {/* Manage / Create / Browse — pinned OUTSIDE CommandList so a long option
          list scrolls under them instead of pushing them past `max-h-[300px]`.
          The `Create "«search»"` row above stays INSIDE the list on purpose: it
          is search-driven and belongs beside the results it filters. */}
        {!isLoading && (canManage || onCreate || onBrowse) && (
          <CommandGroup className='border-t'>
            {canManage && (
              <CommandItem
                onSelect={toggleManageMode}
                disabled={disabled}
                className='cursor-pointer h-7.5'>
                {isManageMode ? (
                  <>
                    <Check className='text-good-500' />
                    <span>Done</span>
                  </>
                ) : (
                  <>
                    <Tags className='text-muted-foreground' />
                    <span>{manageLabel}</span>
                  </>
                )}
              </CommandItem>
            )}
            {onCreate && (
              <CommandItem onSelect={onCreate} disabled={disabled} className='cursor-pointer h-7.5'>
                <Plus className='text-muted-foreground' />
                <span>{createLabel}</span>
              </CommandItem>
            )}
            {onBrowse && (
              <CommandItem onSelect={onBrowse} disabled={disabled} className='cursor-pointer h-7.5'>
                <LayoutGrid className='text-muted-foreground' />
                <span>{browseLabel}</span>
              </CommandItem>
            )}
          </CommandGroup>
        )}
      </Command>
      {/* Rendered as a sibling of <Command>, not a child: React portal events bubble
          to the React parent, so a confirm inside cmdk's tree would feed Enter/Escape
          straight back into the command list. */}
      <ConfirmDialog />
    </>
  )
}
