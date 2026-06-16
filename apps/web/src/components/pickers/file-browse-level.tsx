// apps/web/src/components/pickers/file-browse-level.tsx
'use client'

import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandLoading,
  CommandNavigableItem,
  CommandNavigation,
  CommandSeparator,
  type NavigationItem,
  useCommandNavigation,
  useCommandNavigationOptional,
} from '@auxx/ui/components/command'
import { Kbd } from '@auxx/ui/components/kbd'
import { radioGroupVariants } from '@auxx/ui/components/radio-group'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Circle, File, Folder } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ParentBackHeader } from '~/components/editor/placeholders/placeholder-picker-content'
import type { FileItem } from '~/components/files/files-store'
import { useFilesystemContext } from '~/components/files/provider/filesystem-provider'

/**
 * Navigation item type for files/folders.
 */
export type FileNavigationItem = NavigationItem & {
  id: string
  name: string
}

/**
 * Props for {@link FileBrowseLevel}.
 *
 * The level is host-agnostic: it reads the filesystem from the app-global
 * `FilesystemProvider`, manages folder drill-in on the surrounding
 * `CommandNavigation` (or wraps its own when none is present), and reports row
 * choices through {@link onSelectItem}. The host owns selection semantics — what
 * happens to the chosen item (toggle a set, push to a tray) and whether to
 * close — so this component never mutates selection state itself.
 */
export interface FileBrowseLevelProps {
  /** Currently selected file ids — drives the row indicators. */
  selectedFiles?: string[]
  /** Currently selected folder ids — drives the row indicators. */
  selectedFolders?: string[]
  /** Fired when a file row, or the "this folder" row, is chosen. */
  onSelectItem: (item: FileItem) => void

  // Selection behavior
  allowMultiple?: boolean
  allowFiles?: boolean
  allowFolders?: boolean
  onlyLeafSelection?: boolean

  // Filtering
  fileExtensions?: string[]
  maxFileSize?: number

  // Search
  enableGlobalSearch?: boolean
  searchPlaceholder?: string
  showPath?: boolean

  // Keyboard
  enableKeyboardNavigation?: boolean
  /** Escape / request to dismiss the surface. */
  onRequestClose?: () => void

  /**
   * Focusless mode for chip-driven `/` slash hosts. The host's `/` chip owns
   * focus and the query, driving the list through `useCmdkRemote` — so this
   * level renders NO `CommandInput`, no keyboard footer, and no internal key
   * handling, and reads its filter from {@link query} instead. Folder rows are
   * stamped `data-drilldown` for ArrowRight drill-in.
   */
  remote?: boolean
  /** External filter text (controlled). Used in {@link remote} mode in place of
   *  the internal search input. */
  query?: string

  /**
   * When provided, the browse root shows a back affordance (and ←/Backspace on
   * an empty search returns) to the parent menu — for embedded drill-in hosts.
   */
  onBack?: () => void
  /** Label for the back affordance. Defaults to 'Back'. */
  backLabel?: string
}

/**
 * Right-aligned selection indicator. A checkbox in multi-select mode, a radio
 * dot in single-select mode. Purely visual — the surrounding row owns the click.
 */
function SelectionIndicator({
  allowMultiple,
  selected,
}: {
  allowMultiple: boolean
  selected: boolean
}) {
  if (allowMultiple) {
    return <Checkbox checked={selected} className='pointer-events-none' />
  }
  // Single-select: only render the radio dot when selected; otherwise a bare
  // size-4 spacer keeps row layout stable without showing an empty circle.
  if (!selected) return <span className='size-4' />
  return (
    <span
      className={cn(
        radioGroupVariants({ variant: 'outline', size: 'default' }),
        'pointer-events-none flex items-center justify-center'
      )}>
      <Circle className='size-2!' />
    </span>
  )
}

/**
 * A single file/folder row. Folders are navigate-only (chevron via
 * `hasChildren`); files (and the current-folder row) carry the selection
 * indicator. Single line — an optional muted path suffix shows in search.
 */
function FileRow({
  id,
  name,
  isFolder,
  isSelected,
  isSelectable,
  isNavigable,
  isKeyboardSelected,
  allowMultiple,
  pathText,
  hint,
  drillDown,
  onSelect,
}: {
  id: string
  name: string
  isFolder: boolean
  isSelected: boolean
  isSelectable: boolean
  isNavigable: boolean
  isKeyboardSelected?: boolean
  allowMultiple: boolean
  pathText?: string
  hint?: string
  drillDown?: boolean
  onSelect: () => void
}) {
  return (
    <CommandNavigableItem
      item={{ id, name, label: name }}
      hasChildren={isNavigable}
      drillDown={drillDown}
      onSelect={onSelect}
      className={cn('px-2', isKeyboardSelected && 'bg-accent text-accent-foreground')}>
      <span className='shrink-0 text-muted-foreground'>{isFolder ? <Folder /> : <File />}</span>
      <span className='min-w-0 truncate'>{name}</span>
      {hint && <span className='shrink-0 text-[10px] text-muted-foreground'>{hint}</span>}
      {(pathText || isSelectable) && (
        <div className='ml-auto flex shrink-0 items-center gap-2 pl-2'>
          {pathText && (
            <span className='max-w-[160px] truncate text-xs text-muted-foreground'>{pathText}</span>
          )}
          {isSelectable && (
            <SelectionIndicator allowMultiple={allowMultiple} selected={isSelected} />
          )}
        </div>
      )}
    </CommandNavigableItem>
  )
}

/**
 * Internal file list. Folders navigate (drill in); files toggle selection.
 */
function FilesList({
  items,
  selectedFiles,
  selectedFolders,
  allowMultiple,
  showPathSuffix,
  isGlobalSearch,
  search,
  selectedIndex,
  enableKeyboardNavigation,
  remote,
  onToggleFile,
  onNavigateFolder,
}: {
  items: FileItem[]
  selectedFiles: string[]
  selectedFolders: string[]
  allowMultiple: boolean
  showPathSuffix: boolean
  isGlobalSearch: boolean
  search: string
  selectedIndex: number
  enableKeyboardNavigation: boolean
  remote: boolean
  onToggleFile: (item: FileItem) => void
  onNavigateFolder: (item: FileItem) => void
}) {
  const selectedIds = useMemo(
    () => new Set([...selectedFiles, ...selectedFolders]),
    [selectedFiles, selectedFolders]
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
          const isFolder = item.type === 'folder'
          const isKeyboardSelected = enableKeyboardNavigation && selectedIndex === index
          const pathText = showPathSuffix
            ? item.type === 'file'
              ? (item as FileItem & { hierarchy?: { fullPath: string } }).hierarchy?.fullPath ||
                item.path
              : isGlobalSearch
                ? item.path
                : undefined
            : undefined

          return (
            <FileRow
              key={item.id}
              id={item.id}
              name={item.name}
              isFolder={isFolder}
              isSelected={selectedIds.has(item.id)}
              isSelectable={!isFolder}
              isNavigable={isFolder}
              isKeyboardSelected={isKeyboardSelected}
              allowMultiple={allowMultiple}
              pathText={pathText || undefined}
              drillDown={remote && isFolder}
              onSelect={() => (isFolder ? onNavigateFolder(item) : onToggleFile(item))}
            />
          )
        })}
      </CommandGroup>
    </ScrollArea>
  )
}

/**
 * The browse content: search input, breadcrumb, current-folder row, list,
 * keyboard. Assumes a surrounding `CommandNavigation` (provided by
 * {@link FileBrowseLevel}).
 */
function FileBrowseInner({
  selectedFiles,
  selectedFolders,
  onSelectItem,
  allowMultiple,
  allowFiles,
  allowFolders,
  onlyLeafSelection,
  fileExtensions,
  maxFileSize,
  enableGlobalSearch,
  searchPlaceholder,
  showPath,
  enableKeyboardNavigation,
  onRequestClose,
  onBack,
  backLabel,
  remote,
  search,
  setSearch,
  isGlobalSearchActive,
}: Required<
  Pick<
    FileBrowseLevelProps,
    | 'allowMultiple'
    | 'allowFiles'
    | 'allowFolders'
    | 'onlyLeafSelection'
    | 'enableGlobalSearch'
    | 'searchPlaceholder'
    | 'showPath'
    | 'enableKeyboardNavigation'
  >
> &
  Pick<
    FileBrowseLevelProps,
    | 'selectedFiles'
    | 'selectedFolders'
    | 'onSelectItem'
    | 'fileExtensions'
    | 'maxFileSize'
    | 'onRequestClose'
    | 'onBack'
    | 'backLabel'
  > & {
    remote: boolean
    search: string
    setSearch: (search: string) => void
    isGlobalSearchActive: boolean
  }) {
  const {
    handleKeyDown: handleNavKeyDown,
    current,
    isAtRoot,
    push,
  } = useCommandNavigation<FileNavigationItem>()
  const { items, isLoading, navigateToFolder, totalFiles, hasMoreFiles, loadMoreFiles } =
    useFilesystemContext()
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const isLoadingMoreRef = useRef(false)

  const files = selectedFiles ?? []
  const folders = selectedFolders ?? []

  /** Filtering with optional global search. */
  const filteredItems = useMemo(() => {
    let baseItems = items

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

    return baseItems.filter((item) => {
      if (item.type === 'file' && !allowFiles) return false

      if (item.type === 'file' && fileExtensions && fileExtensions.length > 0) {
        const ext = item.ext?.toLowerCase()
        if (!ext || !fileExtensions.map((e) => e.toLowerCase()).includes(ext)) return false
      }

      if (item.type === 'file' && maxFileSize && item.displaySize > maxFileSize) return false

      return true
    })
  }, [items, search, enableGlobalSearch, allowFiles, fileExtensions, maxFileSize])

  // Keep the filesystem store in sync with the nav stack's current folder.
  useEffect(() => {
    navigateToFolder(current?.id ?? null)
  }, [current, navigateToFolder])

  // Reset the filesystem to root when the level unmounts (popover close).
  useEffect(() => {
    return () => navigateToFolder(null)
  }, [navigateToFolder])

  // Auto-load more files when approaching the end of a global-search list.
  useEffect(() => {
    if (!enableGlobalSearch || !hasMoreFiles || !filteredItems.length) return
    const threshold = Math.max(100, Math.floor(totalFiles * 0.7))
    if (filteredItems.length >= threshold && !isLoadingMoreRef.current) {
      isLoadingMoreRef.current = true
      Promise.resolve(loadMoreFiles()).finally(() => {
        isLoadingMoreRef.current = false
      })
    }
  }, [enableGlobalSearch, hasMoreFiles, filteredItems.length, totalFiles, loadMoreFiles])

  // Reset highlight when the visible list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filteredItems triggers index reset when list changes
  useEffect(() => {
    setSelectedIndex(-1)
  }, [filteredItems])

  const handleToggleFile = useCallback(
    (item: FileItem) => {
      onSelectItem(item)
    },
    [onSelectItem]
  )

  const handleNavigateFolder = useCallback(
    (item: FileItem) => {
      if (item.type !== 'folder') return
      push({ id: item.id, name: item.name, label: item.name })
      setSelectedIndex(-1)
    },
    [push]
  )

  const selectedItem = useMemo(() => {
    if (selectedIndex < 0 || selectedIndex >= filteredItems.length) return null
    const item = filteredItems[selectedIndex]
    return item ? { id: item.id, label: item.name, name: item.name } : null
  }, [selectedIndex, filteredItems])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enableKeyboardNavigation) return

      // ←, →, Enter. ArrowRight pushes the folder via the nav.
      handleNavKeyDown(e, {
        selectedItem,
        onNavigateRight: (item) => {
          const fileItem = filteredItems.find((f) => f.id === item.id)
          if (fileItem?.type === 'folder') {
            setSelectedIndex(-1)
            return true
          }
          return false
        },
        onSelect: (item) => {
          const fileItem = filteredItems.find((f) => f.id === item.id)
          if (!fileItem) return
          if (fileItem.type === 'folder') handleNavigateFolder(fileItem)
          else handleToggleFile(fileItem)
        },
      })

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1))
      } else if (
        (e.key === 'ArrowLeft' || e.key === 'Backspace') &&
        isAtRoot &&
        onBack &&
        !search
      ) {
        // At the browse root, ← / Backspace returns to the parent menu.
        e.preventDefault()
        onBack()
      } else if (e.key === 'Escape') {
        onRequestClose?.()
      }
    },
    [
      enableKeyboardNavigation,
      handleNavKeyDown,
      selectedItem,
      filteredItems,
      handleNavigateFolder,
      handleToggleFile,
      onRequestClose,
      isAtRoot,
      onBack,
      search,
    ]
  )

  // To select a folder you drill into it; the current folder is then offered as
  // a "this folder" row in its own group above the list.
  const showCurrentFolderRow =
    allowFolders && !onlyLeafSelection && !!current && !isGlobalSearchActive

  return (
    <Command shouldFilter={false} onKeyDown={remote ? undefined : handleKeyDown}>
      {onBack && isAtRoot && <ParentBackHeader label={backLabel ?? 'Back'} onBack={onBack} />}
      <CommandList>
        {!remote && (
          <CommandInput
            placeholder={enableGlobalSearch ? `Search ${totalFiles} files...` : searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            loading={isLoading}
            className='h-9'
            autoFocus
          />
        )}

        {isGlobalSearchActive && (
          <div className='px-3 py-1 text-xs text-muted-foreground bg-muted/50 border-b'>
            Searching across all files... ({filteredItems.length} results)
          </div>
        )}

        <CommandBreadcrumb rootLabel='Files' />

        {showCurrentFolderRow && current && (
          <>
            <CommandGroup>
              <FileRow
                id={current.id}
                name={current.name}
                isFolder
                isSelected={folders.includes(current.id)}
                isSelectable
                isNavigable={false}
                allowMultiple={allowMultiple}
                hint='(this folder)'
                onSelect={() =>
                  onSelectItem({ id: current.id, name: current.name, type: 'folder' } as FileItem)
                }
              />
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {isLoading ? (
          <CommandLoading>Loading files…</CommandLoading>
        ) : (
          <FilesList
            items={filteredItems}
            selectedFiles={files}
            selectedFolders={folders}
            allowMultiple={allowMultiple}
            showPathSuffix={isGlobalSearchActive || showPath}
            isGlobalSearch={isGlobalSearchActive}
            search={search}
            selectedIndex={selectedIndex}
            enableKeyboardNavigation={enableKeyboardNavigation}
            remote={remote}
            onToggleFile={handleToggleFile}
            onNavigateFolder={handleNavigateFolder}
          />
        )}
      </CommandList>

      {!remote && enableKeyboardNavigation && (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground bg-neutral-50/50 rounded-b-xl dark:bg-primary-50'>
          <div className='flex items-center gap-3'>
            <span className='flex items-center gap-1'>
              <span>Select</span>
              <Kbd variant='outline'>↵</Kbd>
            </span>
            {!isGlobalSearchActive && (
              <>
                <span className='flex items-center gap-1'>
                  <span>Open</span>
                  <Kbd variant='outline'>→</Kbd>
                </span>
                <span className='flex items-center gap-1'>
                  <span>Back</span>
                  <Kbd variant='outline'>←</Kbd>
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </Command>
  )
}

/**
 * Host-agnostic filesystem browse level. Renders a searchable, drill-in
 * file/folder list as a cmdk command surface. Reuses a surrounding
 * `CommandNavigation` when present (embedded in a larger drill flow), otherwise
 * wraps its own. The host decides what selecting an item does via
 * {@link FileBrowseLevelProps.onSelectItem}.
 */
export function FileBrowseLevel({
  allowMultiple = true,
  allowFiles = true,
  allowFolders = true,
  onlyLeafSelection = false,
  enableGlobalSearch = false,
  searchPlaceholder = 'Search files and folders...',
  showPath = false,
  enableKeyboardNavigation = true,
  remote = false,
  query,
  ...props
}: FileBrowseLevelProps) {
  const parentNav = useCommandNavigationOptional<FileNavigationItem>()
  const [internalSearch, setInternalSearch] = useState('')
  // In remote mode the host's `/` chip owns the query; otherwise the internal
  // CommandInput does.
  const search = remote ? (query ?? '') : internalSearch
  const setSearch = remote ? () => {} : setInternalSearch
  const isGlobalSearchActive = enableGlobalSearch && !!search.trim()

  const inner = (
    <FileBrowseInner
      {...props}
      allowMultiple={allowMultiple}
      allowFiles={allowFiles}
      allowFolders={allowFolders}
      onlyLeafSelection={onlyLeafSelection}
      enableGlobalSearch={enableGlobalSearch}
      searchPlaceholder={searchPlaceholder}
      showPath={showPath}
      enableKeyboardNavigation={enableKeyboardNavigation}
      remote={remote}
      search={search}
      setSearch={setSearch}
      isGlobalSearchActive={isGlobalSearchActive}
    />
  )

  if (parentNav) return inner

  return (
    <CommandNavigation<FileNavigationItem> isGlobalSearch={isGlobalSearchActive}>
      {inner}
    </CommandNavigation>
  )
}
