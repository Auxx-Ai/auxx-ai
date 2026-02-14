// apps/web/src/components/pickers/files-picker.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandNavigation,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes } from '@auxx/utils/file'
import { ChevronRight, File, Folder } from 'lucide-react'
import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileItem } from '~/components/files/files-store'
import { useFilesystemContext } from '~/components/files/provider/filesystem-provider'

/**
 * Selection state interface
 */
export interface FileSelection {
  files: string[]
  folders: string[]
}

/**
 * Navigation item type for files/folders
 */
type FileNavigationItem = NavigationItem & {
  id: string
  name: string
}

/**
 * Props for the FilesPicker component
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
  enableGlobalSearch?: boolean
  searchPlaceholder?: string
  showPath?: boolean

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
  enableKeyboardNavigation?: boolean
  onSelect?: (item: FileItem) => void
}

/**
 * Internal file list component that uses the navigation context
 */
function FilesList({
  items,
  selectedFiles,
  selectedFolders,
  onChange,
  onOpenChange,
  allowMultiple,
  allowFiles,
  allowFolders,
  onlyLeafSelection,
  enableGlobalSearch,
  showPath,
  search,
  enableKeyboardNavigation,
  selectedIndex,
  onSelect,
  navigateToFolder,
}: {
  items: FileItem[]
  selectedFiles: string[]
  selectedFolders: string[]
  onChange?: (selection: FileSelection) => void
  onOpenChange: (open: boolean) => void
  allowMultiple: boolean
  allowFiles: boolean
  allowFolders: boolean
  onlyLeafSelection: boolean
  enableGlobalSearch: boolean
  showPath: boolean
  search: string
  enableKeyboardNavigation: boolean
  selectedIndex: number
  onSelect?: (item: FileItem) => void
  navigateToFolder: (folderId: string | null) => void
}) {
  const { push } = useCommandNavigation<FileNavigationItem>()

  const allSelectedIds = useMemo(() => {
    return new Set([...selectedFiles, ...selectedFolders])
  }, [selectedFiles, selectedFolders])

  /**
   * Handle item selection
   */
  const toggleItem = useCallback(
    (item: FileItem) => {
      // If it's a folder and folders are not allowed for selection, or in leaf-only mode, navigate instead
      if (item.type === 'folder' && (!allowFolders || onlyLeafSelection)) {
        push({ id: item.id, name: item.name, label: item.name })
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
      push,
      navigateToFolder,
      onOpenChange,
    ]
  )

  /**
   * Navigate to folder
   */
  const handleNavigateToFolder = useCallback(
    (item: FileItem) => {
      if (item.type !== 'folder') return
      push({ id: item.id, name: item.name, label: item.name })
      navigateToFolder(item.id)
    },
    [push, navigateToFolder]
  )

  /**
   * Get appropriate icon for item
   */
  const getItemIcon = useCallback((item: FileItem) => {
    if (item.type === 'folder') {
      return <Folder className='h-4 w-4' />
    }
    return <File className='h-4 w-4' />
  }, [])

  /**
   * Check if item is selectable
   */
  const isItemSelectable = useCallback(
    (item: FileItem) => {
      if (item.type === 'folder' && !allowFolders) {
        return false
      }
      if (onlyLeafSelection && item.type === 'folder') {
        return false
      }
      return true
    },
    [allowFolders, onlyLeafSelection]
  )

  if (items.length === 0) {
    return (
      <CommandEmpty>{search ? 'No files or folders found.' : 'This folder is empty.'}</CommandEmpty>
    )
  }

  return (
    <ScrollArea className='max-h-[300px]'>
      <CommandGroup>
        {items.map((item, index) => {
          const isSelected = allSelectedIds.has(item.id)
          const isSelectable = isItemSelectable(item)
          const canNavigate = item.type === 'folder'
          const isKeyboardSelected = enableKeyboardNavigation && selectedIndex === index

          return (
            <CommandItem
              key={item.id}
              value={item.id}
              onSelect={() => {
                if (onSelect) onSelect(item)
                toggleItem(item)
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between px-2',
                isKeyboardSelected && 'bg-accent text-accent-foreground'
              )}>
              <div className='flex items-center space-x-2 flex-1 min-w-0'>
                {isSelectable && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleItem(item)}
                    aria-label={`Select ${item.name}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                {getItemIcon(item)}
                <div className='flex-1 min-w-0'>
                  <div className='font-medium truncate'>{item.name}</div>

                  {item.type === 'file' && (
                    <div className='text-xs text-muted-foreground'>
                      {formatBytes(item.displaySize)}
                      {item.ext && ` • ${item.ext.toUpperCase()}`}

                      {(showPath || (enableGlobalSearch && search.trim())) && (
                        <>
                          {' • '}
                          <span className='truncate'>
                            {(item as FileItem & { hierarchy?: { fullPath: string } }).hierarchy
                              ?.fullPath || item.path}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {item.type === 'folder' && enableGlobalSearch && search.trim() && item.path && (
                    <div className='text-xs text-muted-foreground truncate'>{item.path}</div>
                  )}
                </div>
              </div>

              <div className='flex items-center space-x-1'>
                {canNavigate && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleNavigateToFolder(item)
                    }}>
                    <ChevronRight className='h-4 w-4' />
                    <span className='sr-only'>Open folder</span>
                  </Button>
                )}
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>
    </ScrollArea>
  )
}

/**
 * Inner content component that has access to CommandNavigation context
 */
function FilesPickerContent({
  items,
  filteredItems,
  selectedFiles,
  selectedFolders,
  onChange,
  onOpenChange,
  allowMultiple,
  allowFiles,
  allowFolders,
  onlyLeafSelection,
  enableGlobalSearch,
  showPath,
  search,
  setSearch,
  searchPlaceholder,
  totalFiles,
  hasMoreFiles,
  enableKeyboardNavigation,
  onSelect,
  navigateToFolder,
  isLoading,
  isGlobalSearchActive,
  searchInputRef,
}: {
  items: FileItem[]
  filteredItems: FileItem[]
  selectedFiles: string[]
  selectedFolders: string[]
  onChange?: (selection: FileSelection) => void
  onOpenChange: (open: boolean) => void
  allowMultiple: boolean
  allowFiles: boolean
  allowFolders: boolean
  onlyLeafSelection: boolean
  enableGlobalSearch: boolean
  showPath: boolean
  search: string
  setSearch: (search: string) => void
  searchPlaceholder: string
  totalFiles: number
  hasMoreFiles: boolean
  enableKeyboardNavigation: boolean
  onSelect?: (item: FileItem) => void
  navigateToFolder: (folderId: string | null) => void
  isLoading: boolean
  isGlobalSearchActive: boolean
  searchInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const { handleKeyDown: handleNavKeyDown } = useCommandNavigation<FileNavigationItem>()
  const [selectedIndex, setSelectedIndex] = useState(-1)

  // Reset selected index when filtered items change
  // biome-ignore lint/correctness/useExhaustiveDependencies: filteredItems triggers index reset when list changes
  useEffect(() => {
    setSelectedIndex(-1)
  }, [filteredItems])

  // Get selected item for keyboard navigation
  const selectedItem = useMemo(() => {
    if (selectedIndex < 0 || selectedIndex >= filteredItems.length) return null
    const item = filteredItems[selectedIndex]
    return item ? { id: item.id, label: item.name, name: item.name } : null
  }, [selectedIndex, filteredItems])

  /**
   * Toggle item selection
   */
  const toggleItem = useCallback(
    (item: FileItem) => {
      const allSelectedIds = new Set([...selectedFiles, ...selectedFolders])
      const isSelected = allSelectedIds.has(item.id)

      if (isSelected) {
        if (item.type === 'file') {
          onChange?.({
            files: selectedFiles.filter((id) => id !== item.id),
            folders: selectedFolders,
          })
        } else {
          onChange?.({
            files: selectedFiles,
            folders: selectedFolders.filter((id) => id !== item.id),
          })
        }
      } else {
        if (!allowMultiple) {
          if (item.type === 'file') {
            onChange?.({ files: [item.id], folders: [] })
          } else {
            onChange?.({ files: [], folders: [item.id] })
          }
          onOpenChange(false)
        } else {
          if (item.type === 'file') {
            onChange?.({ files: [...selectedFiles, item.id], folders: selectedFolders })
          } else {
            onChange?.({ files: selectedFiles, folders: [...selectedFolders, item.id] })
          }
        }
      }
    },
    [selectedFiles, selectedFolders, onChange, allowMultiple, onOpenChange]
  )

  /**
   * Keyboard handler combining navigation and selection
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enableKeyboardNavigation) return

      // Handle navigation keys (←, →, Enter)
      handleNavKeyDown(e, {
        selectedItem,
        onNavigateRight: (item) => {
          const fileItem = filteredItems.find((f) => f.id === item.id)
          if (fileItem?.type === 'folder') {
            navigateToFolder(fileItem.id)
            setSelectedIndex(-1)
            return true
          }
          return false
        },
        onSelect: (item) => {
          const fileItem = filteredItems.find((f) => f.id === item.id)
          if (fileItem) {
            if (onSelect) onSelect(fileItem)
            // For folders in leaf-only mode, navigate instead of select
            if (fileItem.type === 'folder' && (!allowFolders || onlyLeafSelection)) {
              navigateToFolder(fileItem.id)
              setSelectedIndex(-1)
            } else {
              toggleItem(fileItem)
            }
          }
        },
      })

      // Handle selection keys (↑, ↓)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1))
      } else if (e.key === 'Escape') {
        onOpenChange(false)
      }
    },
    [
      enableKeyboardNavigation,
      handleNavKeyDown,
      selectedItem,
      filteredItems,
      navigateToFolder,
      onSelect,
      allowFolders,
      onlyLeafSelection,
      toggleItem,
      onOpenChange,
    ]
  )

  return (
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
          className='h-9'
          autoFocus
        />

        {/* Global search indicator */}
        {isGlobalSearchActive && (
          <div className='px-3 py-1 text-xs text-muted-foreground bg-muted/50 border-b'>
            Searching across all files... ({filteredItems.length} results)
          </div>
        )}

        <CommandBreadcrumb rootLabel='Files' />

        {isLoading ? (
          <div className='py-6 text-center text-sm text-muted-foreground'>Loading files...</div>
        ) : (
          <FilesList
            items={filteredItems}
            selectedFiles={selectedFiles}
            selectedFolders={selectedFolders}
            onChange={onChange}
            onOpenChange={onOpenChange}
            allowMultiple={allowMultiple}
            allowFiles={allowFiles}
            allowFolders={allowFolders}
            onlyLeafSelection={onlyLeafSelection}
            enableGlobalSearch={enableGlobalSearch}
            showPath={showPath}
            search={search}
            enableKeyboardNavigation={enableKeyboardNavigation}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            navigateToFolder={navigateToFolder}
          />
        )}
      </CommandList>

      {/* Keyboard shortcuts footer */}
      {enableKeyboardNavigation && (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground bg-neutral-50/50'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-3'>
              <span className='flex items-center gap-1'>
                <span>Select</span>
                <kbd className='px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono'>↵</kbd>
              </span>
              {!isGlobalSearchActive && (
                <>
                  <span className='flex items-center gap-1'>
                    <span>Open</span>
                    <kbd className='px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono'>
                      →
                    </kbd>
                  </span>
                  <span className='flex items-center gap-1'>
                    <span>Back</span>
                    <kbd className='px-1.5 py-0.5 bg-white border rounded text-[10px] font-mono'>
                      ←
                    </kbd>
                  </span>
                </>
              )}
            </div>
            {enableGlobalSearch && (
              <div className='text-xs'>
                {search.trim() ? `${totalFiles} files total` : `${filteredItems.length} items`}
                {hasMoreFiles && search.trim() && ' (loading more...)'}
              </div>
            )}
          </div>
        </div>
      )}
    </Command>
  )
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
  enableKeyboardNavigation = true,
  onSelect,
}: FilesPickerProps): React.ReactElement {
  // Internal open state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false)

  // Use controlled or uncontrolled open state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange || setInternalOpen

  // Filesystem context
  const { items, isLoading, navigateToFolder, totalFiles, hasMoreFiles, loadMoreFiles } =
    useFilesystemContext()

  // Local state
  const [search, setSearch] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isLoadingMoreRef = useRef(false)

  /**
   * Enhanced filtering with global search capability
   */
  const filteredItems = useMemo(() => {
    let baseItems = items

    // Apply search filter first
    if (enableGlobalSearch && search.trim()) {
      const query = search.toLowerCase()
      baseItems = baseItems.filter((item) => {
        if (item.name.toLowerCase().includes(query)) return true
        if (item.ext?.toLowerCase().includes(query)) return true
        if (item.path?.toLowerCase().includes(query)) return true
        if (item.type === 'file' && item.mimeType && item.mimeType.toLowerCase().includes(query))
          return true
        return false
      })
    }

    // Apply additional filters
    const filtered = baseItems.filter((item) => {
      if (item.type === 'file' && !allowFiles) return false

      if (item.type === 'file' && fileExtensions && fileExtensions.length > 0) {
        const ext = item.ext?.toLowerCase()
        if (!ext || !fileExtensions.map((e: string) => e.toLowerCase()).includes(ext)) {
          return false
        }
      }

      if (item.type === 'file' && maxFileSize && item.displaySize > maxFileSize) {
        return false
      }

      return true
    })

    return filtered
  }, [items, search, enableGlobalSearch, allowFiles, fileExtensions, maxFileSize])

  // Auto-load more files when approaching end of list
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
      setSearch('')
      navigateToFolder(null)
    }
  }, [open, navigateToFolder])

  // Auto-focus search input when picker opens
  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  // Determine if global search is active (for hiding breadcrumb)
  const isGlobalSearchActive = enableGlobalSearch && !!search.trim()

  /**
   * Handle navigation change from CommandNavigation
   */
  const handleNavigationChange = useCallback(
    (stack: FileNavigationItem[], current: FileNavigationItem | null) => {
      navigateToFolder(current?.id || null)
      // Scroll to top when navigating
      if (contentRef.current) {
        contentRef.current.scrollTop = 0
      }
    },
    [navigateToFolder]
  )

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
        <CommandNavigation<FileNavigationItem>
          isGlobalSearch={isGlobalSearchActive}
          onNavigationChange={handleNavigationChange}>
          <FilesPickerContent
            items={items}
            filteredItems={filteredItems}
            selectedFiles={selectedFiles}
            selectedFolders={selectedFolders}
            onChange={onChange}
            onOpenChange={onOpenChange}
            allowMultiple={allowMultiple}
            allowFiles={allowFiles}
            allowFolders={allowFolders}
            onlyLeafSelection={onlyLeafSelection}
            enableGlobalSearch={enableGlobalSearch}
            showPath={showPath}
            search={search}
            setSearch={setSearch}
            searchPlaceholder={searchPlaceholder}
            totalFiles={totalFiles}
            hasMoreFiles={hasMoreFiles}
            enableKeyboardNavigation={enableKeyboardNavigation}
            onSelect={onSelect}
            navigateToFolder={navigateToFolder}
            isLoading={isLoading}
            isGlobalSearchActive={isGlobalSearchActive}
            searchInputRef={searchInputRef}
          />
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}

export const FilesPicker = memo(filesPicker)
