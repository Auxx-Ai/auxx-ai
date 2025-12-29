// apps/web/src/components/pickers/files-picker.tsx
'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@auxx/ui/components/command'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { ChevronRight, ChevronLeft, File, Folder } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes } from '@auxx/lib/utils'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { useFilesystemContext } from '~/components/files/provider/filesystem-provider'
import type { FileItem } from '~/components/files/files-store'

/**
 * Selection state interface
 */
export interface FileSelection {
  files: string[]
  folders: string[]
}

/**
 * Props for the FilesPicker component - Enhanced with global search
 */
interface FilesPickerProps {
  // Selection control
  selectedFiles?: string[]
  selectedFolders?: string[]
  onChange?: (selection: FileSelection) => void

  // Selection behavior
  allowMultiple?: boolean
  allowFiles?: boolean
  allowFolders?: boolean
  onlyLeafSelection?: boolean

  // Filtering
  fileExtensions?: string[]
  maxFileSize?: number

  // Enhanced search capabilities
  enableGlobalSearch?: boolean // Enable search across all files, not just current folder
  searchPlaceholder?: string // Custom placeholder for search input
  showPath?: boolean // Show file paths in search results

  // Popover control
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode

  // UI control
  className?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number

  // Content sizing
  width?: number | string
  maxHeight?: number | string

  // Keyboard navigation
  enableKeyboardNavigation?: boolean // Enable arrow keys and Enter
  onSelect?: (item: FileItem) => void // Called when item is selected with keyboard
}

/**
 * Files picker component with Popover wrapper
 */
function filesPicker({
  selectedFiles = [],
  selectedFolders = [],
  onChange,
  allowMultiple = true,
  allowFiles = true,
  allowFolders = true,
  onlyLeafSelection = false,
  fileExtensions,
  maxFileSize,
  enableGlobalSearch = false,
  searchPlaceholder = 'Search files and folders...',
  showPath = false,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
  disabled = false,
  className,
  align = 'start',
  side = 'bottom',
  sideOffset = 4,
  width = 400,
  maxHeight = 400,
  enableKeyboardNavigation = true,
  onSelect,
}: FilesPickerProps): React.ReactElement {
  // Internal open state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false)

  // Use controlled or uncontrolled open state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange || setInternalOpen
  // Filesystem context - Maps-optimized bulk loading
  const {
    items,
    currentFolderId,
    breadcrumbs,
    isLoading,
    navigateToFolder,
    totalFiles,
    hasMoreFiles,
    loadMoreFiles,
  } = useFilesystemContext()

  // Local state
  const [search, setSearch] = useState('')
  const [navigationStack, setNavigationStack] = useState<
    Array<{ id: string | null; name: string }>
  >([])
  const [selectedIndex, setSelectedIndex] = useState(-1) // For keyboard navigation
  const contentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isLoadingMoreRef = useRef(false) // Prevent infinite auto-loading

  // Combined selection state
  const allSelectedIds = useMemo(() => {
    return new Set([...selectedFiles, ...selectedFolders])
  }, [selectedFiles, selectedFolders])

  // Note: Search is now handled locally in filteredItems, not globally

  /**
   * Enhanced filtering with global search capability
   */
  const filteredItems = useMemo(() => {
    let baseItems = items // All items from filesystem

    // Apply search filter first (only if enableGlobalSearch and search query exists)
    if (enableGlobalSearch && search.trim()) {
      const query = search.toLowerCase()
      baseItems = baseItems.filter((item) => {
        // Search in item name
        if (item.name.toLowerCase().includes(query)) return true

        // Search in file extension
        if (item.ext && item.ext.toLowerCase().includes(query)) return true

        // Search in path
        if (item.path && item.path.toLowerCase().includes(query)) return true

        // Search in MIME type for files
        if (item.type === 'file' && item.mimeType && item.mimeType.toLowerCase().includes(query))
          return true

        return false
      })
    }

    // Apply additional filters
    let filtered = baseItems.filter((item) => {
      // Filter by type
      if (item.type === 'file' && !allowFiles) return false
      // Note: Folders are always shown for navigation, even when allowFolders = false

      // Filter files by extension
      if (item.type === 'file' && fileExtensions && fileExtensions.length > 0) {
        const ext = item.ext?.toLowerCase()
        if (!ext || !fileExtensions.map((e: string) => e.toLowerCase()).includes(ext)) {
          return false
        }
      }

      // Filter files by size
      if (item.type === 'file' && maxFileSize && item.displaySize > maxFileSize) {
        return false
      }

      return true
    })

    return filtered
  }, [items, search, enableGlobalSearch, allowFiles, allowFolders, fileExtensions, maxFileSize])

  /**
   * Handle item selection
   */
  const toggleItem = useCallback(
    (item: any) => {
      // If it's a folder and folders are not allowed for selection, or in leaf-only mode, navigate instead
      if (item.type === 'folder' && (!allowFolders || onlyLeafSelection)) {
        navigateToFolder(item.id)
        return
      }

      const isSelected = allSelectedIds.has(item.id)

      if (isSelected) {
        // Remove from selection
        if (item.type === 'file') {
          onChange?.({
            files: selectedFiles.filter((id: string) => id !== item.id),
            folders: selectedFolders,
          })
        } else {
          onChange?.({
            files: selectedFiles,
            folders: selectedFolders.filter((id: string) => id !== item.id),
          })
        }
      } else {
        // Add to selection
        if (!allowMultiple) {
          // Single select mode
          if (item.type === 'file') {
            onChange?.({ files: [item.id], folders: [] })
          } else {
            onChange?.({ files: [], folders: [item.id] })
          }
          onOpenChange(false)
        } else {
          // Multi select mode
          if (item.type === 'file') {
            onChange?.({
              files: [...selectedFiles, item.id],
              folders: selectedFolders,
            })
          } else {
            onChange?.({
              files: selectedFiles,
              folders: [...selectedFolders, item.id],
            })
          }
        }
      }
    },
    [
      allSelectedIds,
      selectedFiles,
      selectedFolders,
      onChange,
      allowMultiple,
      allowFolders,
      onlyLeafSelection,
      navigateToFolder,
      onOpenChange,
    ]
  )

  /**
   * Navigate to folder
   */
  const handleNavigateToFolder = useCallback(
    (item: any) => {
      if (item.type !== 'folder') return

      setNavigationStack((prev) => [
        ...prev,
        { id: currentFolderId, name: breadcrumbs[breadcrumbs.length - 1]?.name || 'Files' },
      ])
      navigateToFolder(item.id)
      setSearch('')

      // Scroll to top
      if (contentRef.current) {
        contentRef.current.scrollTop = 0
      }
    },
    [currentFolderId, breadcrumbs, navigateToFolder]
  )

  /**
   * Navigate back
   */
  const navigateBack = useCallback(() => {
    if (navigationStack.length === 0) return

    const newStack = [...navigationStack]
    const prevLevel = newStack.pop()
    setNavigationStack(newStack)

    if (prevLevel) {
      navigateToFolder(prevLevel.id)
    }
  }, [navigationStack, navigateToFolder])

  /**
   * Navigate to specific breadcrumb level
   */
  const navigateToBreadcrumb = useCallback(
    (index: number) => {
      const targetCrumb = breadcrumbs[index]
      if (!targetCrumb) return

      // Reset navigation stack to match the new level
      setNavigationStack([])
      navigateToFolder(targetCrumb.id)
    },
    [breadcrumbs, navigateToFolder]
  )

  // Auto-load more files when approaching end of list (for global search) - with infinite loop protection
  useEffect(() => {
    if (!enableGlobalSearch || !hasMoreFiles || !filteredItems.length) return

    const threshold = Math.max(100, Math.floor(totalFiles * 0.7))
    const shouldLoad = filteredItems.length >= threshold && !isLoadingMoreRef.current

    if (shouldLoad) {
      isLoadingMoreRef.current = true
      Promise.resolve(loadMoreFiles()).finally(() => {
        isLoadingMoreRef.current = false
      })
    }
  }, [enableGlobalSearch, hasMoreFiles, filteredItems.length, totalFiles, loadMoreFiles])

  /**
   * Reset state when popover closes
   */
  useEffect(() => {
    if (!open) {
      setNavigationStack([])
      setSearch('')
      setSelectedIndex(-1)
      navigateToFolder(null) // Reset to root
    }
  }, [open, navigateToFolder]) // Remove setSearchQuery from deps to prevent infinite loops

  /**
   * Keyboard navigation handler
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enableKeyboardNavigation) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1))
      } else if (e.key === 'ArrowLeft' && breadcrumbs.length > 1 && !search.trim()) {
        e.preventDefault()
        const parentBreadcrumb = breadcrumbs[breadcrumbs.length - 2]
        navigateToFolder(parentBreadcrumb.id)
      } else if (e.key === 'ArrowRight' && selectedIndex >= 0) {
        e.preventDefault()
        const selectedItem = filteredItems[selectedIndex]
        if (selectedItem?.type === 'folder') {
          handleNavigateToFolder(selectedItem)
        }
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault()
        const selectedItem = filteredItems[selectedIndex]
        if (selectedItem) {
          if (onSelect) {
            onSelect(selectedItem)
          }
          toggleItem(selectedItem)
        }
      } else if (e.key === 'Escape') {
        onOpenChange(false)
      }
    },
    [
      enableKeyboardNavigation,
      filteredItems,
      breadcrumbs,
      search,
      selectedIndex,
      handleNavigateToFolder,
      onSelect,
      toggleItem,
      navigateToFolder,
      onOpenChange,
    ]
  )

  /**
   * Reset selected index when filtered items change
   */
  useEffect(() => {
    setSelectedIndex(-1)
  }, [filteredItems])

  /**
   * Get appropriate icon for item
   */
  const getItemIcon = useCallback((item: any) => {
    if (item.type === 'folder') {
      return <Folder className="h-4 w-4" />
    }
    return <File className="h-4 w-4" />
  }, [])

  /**
   * Check if item is selectable
   */
  const isItemSelectable = useCallback(
    (item: any) => {
      // Folders are not selectable when allowFolders is false
      if (item.type === 'folder' && !allowFolders) {
        return false
      }

      // Folders are not selectable in leaf-only selection mode
      if (onlyLeafSelection && item.type === 'folder') {
        return false
      }

      return true
    },
    [allowFolders, onlyLeafSelection]
  )

  // Auto-focus search input when picker opens
  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  // If trigger is provided, wrap in Popover
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0', className)}
        ref={contentRef}
        align={align}
        side={side}
        sideOffset={sideOffset}
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
        }}>
        <Command shouldFilter={false} onKeyDown={handleKeyDown}>
          <CommandList>
            <CommandInput
              ref={searchInputRef}
              placeholder={
                enableGlobalSearch
                  ? `Search ${totalFiles} files...`
                  : searchPlaceholder || 'Search files and folders...'
              }
              value={search}
              onValueChange={setSearch}
              className="h-9"
              autoFocus
            />

            {/* Global search indicator */}
            {enableGlobalSearch && search.trim() && (
              <div className="px-3 py-1 text-xs text-muted-foreground bg-muted/50 border-b">
                Searching across all files... ({filteredItems.length} results)
              </div>
            )}

            {/* Breadcrumb Navigation */}
            {!search && breadcrumbs.length > 1 && (
              <div className="flex items-center border-b px-2 py-1 text-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={navigateBack}
                  disabled={navigationStack.length === 0}
                  className="h-6 w-6 p-0">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span className="sr-only">Back</span>
                </Button>

                <div className="flex items-center overflow-x-auto">
                  {breadcrumbs.map((crumb, index) => (
                    <div key={crumb.id || 'root'} className="flex items-center">
                      {index > 0 && (
                        <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                      )}
                      <button
                        onClick={() => navigateToBreadcrumb(index)}
                        className={cn(
                          'whitespace-nowrap px-1 hover:underline',
                          index === breadcrumbs.length - 1 ? 'font-semibold' : ''
                        )}>
                        {crumb.name}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading files...</div>
            ) : filteredItems.length === 0 ? (
              <CommandEmpty>
                {search ? 'No files or folders found.' : 'This folder is empty.'}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                <ScrollArea
                  className="max-h-[300px]"
                  style={{
                    maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
                  }}>
                  {filteredItems.map((item, index) => {
                    const isSelected = allSelectedIds.has(item.id)
                    const isSelectable = isItemSelectable(item)
                    const canNavigate = item.type === 'folder'
                    const isKeyboardSelected = enableKeyboardNavigation && selectedIndex === index

                    return (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => toggleItem(item)}
                        className={cn(
                          'flex cursor-pointer items-center justify-between px-2',
                          isKeyboardSelected && 'bg-accent text-accent-foreground'
                        )}>
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          {isSelectable && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleItem(item)}
                              aria-label={`Select ${item.name}`}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}

                          {getItemIcon(item)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{item.name}</div>

                            {/* Enhanced file info with optional path display */}
                            {item.type === 'file' && (
                              <div className="text-xs text-muted-foreground">
                                {formatBytes(item.displaySize)}
                                {item.ext && ` • ${item.ext.toUpperCase()}`}

                                {/* Show path for global search results or when explicitly requested */}
                                {(showPath || (enableGlobalSearch && search.trim())) && (
                                  <>
                                    {' • '}
                                    <span className="truncate">
                                      {(item as any).hierarchy?.fullPath || item.path}
                                    </span>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Show folder path for global search results */}
                            {item.type === 'folder' &&
                              enableGlobalSearch &&
                              search.trim() &&
                              item.path && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {item.path}
                                </div>
                              )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-1">
                          {canNavigate && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleNavigateToFolder(item)
                              }}>
                              <ChevronRight className="h-4 w-4" />
                              <span className="sr-only">Open folder</span>
                            </Button>
                          )}
                        </div>
                      </CommandItem>
                    )
                  })}
                </ScrollArea>
              </CommandGroup>
            )}
          </CommandList>

          {/* Keyboard shortcuts footer */}
          {enableKeyboardNavigation && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground bg-neutral-50/50">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span>Select</span>
                    <kbd className="px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono">
                      ↵
                    </kbd>
                  </span>
                  {(!search || !enableGlobalSearch) && (
                    <>
                      <span className="flex items-center gap-1">
                        <span>Open</span>
                        <kbd className="px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono">
                          →
                        </kbd>
                      </span>
                      <span className="flex items-center gap-1">
                        <span>Back</span>
                        <kbd className="px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono">
                          ←
                        </kbd>
                      </span>
                    </>
                  )}
                </div>
                {enableGlobalSearch && (
                  <div className="text-xs">
                    {search.trim() ? `${totalFiles} files total` : `${filteredItems.length} items`}
                    {hasMoreFiles && search.trim() && ' (loading more...)'}
                  </div>
                )}
              </div>
            </div>
          )}
        </Command>
      </PopoverContent>{' '}
    </Popover>
  )
}

export const FilesPicker = memo(filesPicker)
