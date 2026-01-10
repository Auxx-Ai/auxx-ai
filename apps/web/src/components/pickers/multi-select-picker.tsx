// apps/web/src/components/pickers/multi-select-picker.tsx
'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Plus, Tags, Trash2, Check, X, TextCursorInput, Pencil, Loader2 } from 'lucide-react'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '@auxx/ui/components/command'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Button } from '@auxx/ui/components/button'
import { Circle } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import type { SelectOption } from '@auxx/types/custom-field'

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

  // Filter options by search value
  const filteredOptions = useMemo(() => {
    if (!searchValue.trim()) return localOptions
    const search = searchValue.toLowerCase()
    return localOptions.filter((opt) => opt.label.toLowerCase().includes(search))
  }, [localOptions, searchValue])

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

    // Generate random ID for value
    const newId = crypto.randomUUID()
    const newOption: SelectOption = { label: newLabel, value: newId }

    // Update options and auto-select the new option
    updateOptions([...localOptions, newOption])
    updateSelected([...localSelected, newId])

    setSearchValue('')
  }, [canAdd, searchValue, localOptions, localSelected, updateOptions, updateSelected])

  /**
   * Delete an option
   */
  const deleteOption = useCallback(
    (optValue: string) => {
      const newOptions = localOptions.filter((opt) => opt.value !== optValue)
      updateOptions(newOptions)

      // Also remove from selection if selected
      if (localSelected.includes(optValue)) {
        updateSelected(localSelected.filter((v) => v !== optValue))
      }
    },
    [localOptions, localSelected, updateOptions, updateSelected]
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
  }, [])

  /**
   * Save the edited option label
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

    // Update only the label, keep other properties
    const newOptions = localOptions.map((opt) =>
      opt.value === editingOptionId ? { ...opt, label: newLabel } : opt
    )

    updateOptions(newOptions)
    cancelEdit()
  }, [editingOptionId, editInputValue, localOptions, updateOptions, cancelEdit])

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

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      {/* Search/Edit Input Area */}
      {editingOptionId ? (
        <div className="flex items-center border-b border-border/50 ps-3 pe-1">
          <TextCursorInput className="mr-2 size-4 shrink-0 opacity-50" />
          <input
            ref={editInputRef}
            className="flex h-8 w-full rounded-md bg-transparent py-1 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            value={editInputValue}
            onChange={(e) => setEditInputValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            placeholder="Edit option name..."
            disabled={disabled}
          />
          <button
            type="button"
            onClick={saveEdit}
            disabled={disabled}
            className="rounded-full cursor-default flex items-center justify-center hover:bg-good-100 hover:text-good-500 size-5 shrink-0 mx-0.5">
            <Check className="size-3" />
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={disabled}
            className="rounded-full cursor-default flex items-center justify-center hover:bg-bad-100 hover:text-bad-500 size-5 shrink-0">
            <X className="size-3" />
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
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <>
            {/* Create option */}
            {canAdd && searchValue.trim() && !searchMatchesExisting && (
              <>
                <CommandGroup>
                  <CommandItem
                    onSelect={createOption}
                    className="cursor-pointer h-7"
                    disabled={disabled}>
                    <Plus className="text-muted-foreground" />
                    <span>
                      Create "<span className="font-medium">{searchValue.trim()}</span>"
                    </span>
                  </CommandItem>
                </CommandGroup>
                <div className="-mx-1 h-px bg-border/50" />
              </>
            )}

            {/* Options List */}
            {filteredOptions.length === 0 && !searchValue.trim() && (
              <CommandEmpty>No options yet. Type to create one.</CommandEmpty>
            )}
            {filteredOptions.length > 0 && (
              <>
                <CommandGroup>
                  {filteredOptions.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.label}
                      onSelect={() => {
                        if (isManageMode) {
                          startEdit(opt.value)
                        } else {
                          handleSelect(opt.value)
                        }
                      }}
                      disabled={disabled}
                      className={cn(
                        'cursor-pointer h-7',
                        isManageMode && 'py-0 pe-1',
                        editingOptionId === opt.value && 'bg-primary-200'
                      )}>
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          {/* Selection indicator (checkbox/radio) or manage icon */}
                          <div className="w-5 flex items-center justify-center">
                            {isManageMode ? (
                              <Pencil className="size-4 text-muted-foreground" />
                            ) : multi ? (
                              <Checkbox
                                checked={localSelected.includes(opt.value)}
                                className="pointer-events-none"
                              />
                            ) : (
                              /* Visual-only radio indicator (not a real RadioGroupItem) */
                              <div
                                className={cn(
                                  'size-4 rounded-full border border-foreground flex items-center justify-center',
                                  localSelected.includes(opt.value) && '[&_svg]:fill-foreground'
                                )}>
                                {localSelected.includes(opt.value) && <Circle className="size-2" />}
                              </div>
                            )}
                          </div>

                          {/* Color dot (if option has color) */}
                          {opt.color && (
                            <div
                              className={cn(
                                'size-3 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10',
                                getColorSwatch(opt.color)
                              )}
                            />
                          )}

                          {/* Option label */}
                          <span>{opt.label}</span>
                        </div>

                        {/* Delete button in manage mode */}
                        {isManageMode && (
                          <Button
                            variant="destructive-hover"
                            type="button"
                            size="icon-xs"
                            disabled={disabled}
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteOption(opt.value)
                            }}>
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <div className="-mx-1 h-px bg-border/50" />
              </>
            )}

            {/* Manage button */}
            {canManage && (
              <CommandGroup>
                <CommandItem
                  onSelect={toggleManageMode}
                  disabled={disabled}
                  className="cursor-pointer h-7.5">
                  {isManageMode ? (
                    <>
                      <Check className="text-good-500" />
                      <span>Done</span>
                    </>
                  ) : (
                    <>
                      <Tags className="text-muted-foreground" />
                      <span>{manageLabel}</span>
                    </>
                  )}
                </CommandItem>
              </CommandGroup>
            )}

            {/* Create button for complex items */}
            {onCreate && (
              <CommandGroup>
                <CommandItem
                  onSelect={onCreate}
                  disabled={disabled}
                  className="cursor-pointer h-7.5">
                  <Plus className="text-muted-foreground" />
                  <span>{createLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </Command>
  )
}
