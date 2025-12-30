// apps/web/src/components/contacts/input/tags-input-field.tsx
'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Plus, Tags, Trash2, Check, X, TextCursorInput, Pencil } from 'lucide-react'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '@auxx/ui/components/command'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'
import { usePropertyContext } from '../drawer/property-provider'
import { useFieldNavigationOptional } from '../drawer/field-navigation-context'
import { api } from '~/trpc/react'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'

/**
 * TagsInputField
 * Command-based tag selector with create, edit, and delete functionality.
 *
 * Pattern D: Debounced save
 * - Local state for instant UI updates
 * - Debounced commitValue (300ms) for rapid clicking
 * - CAPTURES arrow keys for tag navigation
 */
export function TagsInputField() {
  const { value, field, commitValue } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const utils = api.useUtils()
  const editInputRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Capture keys while open (tags list uses arrows)
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Local state for options (optimistic updates)
  const [localOptions, setLocalOptions] = useState<SelectOption[]>(() => {
    return field?.options?.options || []
  })

  // Local state for selected tags (optimistic updates)
  // Filter to only include values that exist in options (remove orphaned/old string values)
  const [localSelected, setLocalSelected] = useState<string[]>(() => {
    const options = field?.options?.options || []
    const optionValues = new Set(options.map((opt: SelectOption) => opt.value))
    if (Array.isArray(value)) {
      return value.filter((v: string) => optionValues.has(v))
    }
    return []
  })

  // Sync local options when field options change from server
  useEffect(() => {
    const serverOptions = field?.options?.options || []
    if (JSON.stringify(serverOptions) !== JSON.stringify(localOptions)) {
      setLocalOptions(serverOptions)
      // Also filter localSelected to remove any orphaned values
      const optionValues = new Set(serverOptions.map((opt: SelectOption) => opt.value))
      setLocalSelected((prev) => prev.filter((v) => optionValues.has(v)))
    }
  }, [field?.options?.options])

  // UI state
  const [searchValue, setSearchValue] = useState('')
  const [isManageMode, setIsManageMode] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
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

  // Mutation to update field options (fire and forget)
  const updateField = api.customField.update.useMutation({
    onSuccess: () => {
      // Invalidate all custom field queries (same as useCustomField hook)
      utils.customField.getAll.invalidate()
      utils.customField.getByEntityDefinition.invalidate()
      utils.resource.getAllResourceTypes.invalidate()
    },
  })

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingTagId && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingTagId])

  /**
   * Updates field options - optimistic local update, then sync to server
   */
  const updateFieldOptions = (newOptions: SelectOption[]) => {
    // Update local state immediately
    setLocalOptions(newOptions)
    // Fire mutation in background (no await)
    updateField.mutate({
      id: field.id,
      options: newOptions,
    })
  }

  /**
   * Debounced save to server - waits for user to stop clicking
   * Fire-and-forget pattern
   */
  const debouncedSave = useCallback(
    (newSelected: string[]) => {
      // Clear any pending save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Schedule new save after 300ms of inactivity
      saveTimeoutRef.current = setTimeout(() => {
        commitValue(newSelected)
      }, 300)
    },
    [commitValue]
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  /**
   * Updates selected tags - instant local update, debounced server sync
   */
  const updateSelected = (newSelected: string[]) => {
    // Update local state immediately
    setLocalSelected(newSelected)
    // Debounced save to server
    debouncedSave(newSelected)
  }

  /**
   * Toggle tag selection
   */
  const toggleTag = (tagValue: string) => {
    const newSelected = localSelected.includes(tagValue)
      ? localSelected.filter((v) => v !== tagValue)
      : [...localSelected, tagValue]
    updateSelected(newSelected)
  }

  /**
   * Create a new tag with the current search value
   * Generates a random UUID as value, uses input as label
   */
  const createTag = () => {
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

    // Update options and auto-select the new tag
    updateFieldOptions([...localOptions, newOption])
    updateSelected([...localSelected, newId])

    setSearchValue('')
  }

  /**
   * Delete a tag option
   */
  const deleteTag = (tagValue: string) => {
    const newOptions = localOptions.filter((opt) => opt.value !== tagValue)
    updateFieldOptions(newOptions)

    // Also remove from selection if selected
    if (localSelected.includes(tagValue)) {
      updateSelected(localSelected.filter((v) => v !== tagValue))
    }
  }

  /**
   * Start editing a tag
   */
  const startEdit = (tagValue: string) => {
    const tag = localOptions.find((opt) => opt.value === tagValue)
    if (tag) {
      setEditingTagId(tagValue)
      setEditInputValue(tag.label)
    }
  }

  /**
   * Cancel editing
   */
  const cancelEdit = () => {
    setEditingTagId(null)
    setEditInputValue('')
  }

  /**
   * Save the edited tag label
   */
  const saveEdit = () => {
    if (!editingTagId || !editInputValue.trim()) {
      cancelEdit()
      return
    }

    const newLabel = editInputValue.trim()

    // Check for duplicate label (excluding the tag being edited)
    if (
      localOptions.some(
        (opt) => opt.value !== editingTagId && opt.label.toLowerCase() === newLabel.toLowerCase()
      )
    ) {
      cancelEdit()
      return
    }

    // Update only the label, keep the same value (ID)
    const newOptions = localOptions.map((opt) =>
      opt.value === editingTagId ? { ...opt, label: newLabel } : opt
    )

    updateFieldOptions(newOptions)
    cancelEdit()
  }

  /**
   * Handle key events in edit input
   */
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  return (
    <Command shouldFilter={false} className="rounded-lg">
      {/* Search/Edit Input Area */}
      {editingTagId ? (
        <div className="flex items-center border-b border-border/50 ps-3 pe-1">
          <TextCursorInput className="mr-2 size-4 shrink-0 opacity-50" />
          <input
            ref={editInputRef}
            className="flex h-8 w-full rounded-md bg-transparent py-1 text-sm outline-hidden placeholder:text-muted-foreground"
            value={editInputValue}
            onChange={(e) => setEditInputValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            placeholder="Edit tag name..."
          />
          <button
            type="button"
            onClick={saveEdit}
            className="rounded-full cursor-default flex items-center justify-center hover:bg-good-100 hover:text-good-500 size-5 shrink-0 mx-0.5">
            <Check className="size-3" />
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            className="rounded-full cursor-default flex items-center justify-center hover:bg-bad-100 hover:text-bad-500 size-5 shrink-0">
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <CommandInput
          placeholder="Search tags..."
          value={searchValue}
          onValueChange={setSearchValue}
        />
      )}

      <CommandList>
        {searchValue.trim() && !searchMatchesExisting && (
          <>
            <CommandGroup>
              <CommandItem onSelect={createTag} className="cursor-pointer h-7">
                <Plus className="text-muted-foreground" />
                <span>
                  Create "<span className="font-medium">{searchValue.trim()}</span>"
                </span>
              </CommandItem>
            </CommandGroup>
            <div className="-mx-1 h-px bg-border/50" />
          </>
        )}

        {/* Tags List */}
        {filteredOptions.length === 0 && !searchValue.trim() && (
          <CommandEmpty>No tags yet. Type to create one.</CommandEmpty>
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
                      toggleTag(opt.value)
                    }
                  }}
                  className={cn(
                    'cursor-pointer h-7',
                    isManageMode && 'py-0  pe-1',
                    editingTagId === opt.value && 'bg-primary-200'
                  )}>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <div className="w-5 flex items-center justify-center">
                        {isManageMode ? (
                          <Pencil className="size-4 text-muted-foreground" />
                        ) : (
                          <Checkbox
                            checked={localSelected.includes(opt.value)}
                            className="pointer-events-none"
                          />
                        )}
                      </div>
                      <span>{opt.label}</span>
                    </div>
                    {isManageMode && (
                      <Button
                        variant="destructive-hover"
                        type="button"
                        size="icon-xs"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteTag(opt.value)
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
        <CommandGroup>
          <CommandItem
            onSelect={() => {
              if (isManageMode && editingTagId) {
                cancelEdit()
              }
              setIsManageMode(!isManageMode)
            }}
            className="cursor-pointer h-7.5">
            {isManageMode ? (
              <>
                <Check className="text-good-500" />
                <span>Done</span>
              </>
            ) : (
              <>
                <Tags className="text-muted-foreground" />
                <span>Manage tags</span>
              </>
            )}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
