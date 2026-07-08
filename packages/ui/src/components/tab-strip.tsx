// packages/ui/src/components/tab-strip.tsx
'use client'

import { ContextMenu, ContextMenuTrigger } from '@auxx/ui/components/context-menu'
import { RenameInput } from '@auxx/ui/components/rename-input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Minimal shape every tab must satisfy. Callers pass their own richer type. */
export interface TabStripItem {
  id: string
  title: string
}

/** Helpers handed to `renderMenu` so caller-owned menu items can drive strip UI. */
export interface TabMenuHelpers {
  /** Flip this tab into inline-rename mode. */
  startRename: () => void
}

interface TabStripProps<T extends TabStripItem> {
  tabs: T[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  /**
   * Enables the edit affordances (add / rename / reorder / menu). When false the
   * strip is read-only: plain clickable pills. Default `true`.
   */
  editable?: boolean
  /** Commit an inline rename. Omit to disable renaming. */
  onRename?: (tabId: string, title: string) => void
  /**
   * Presentational reorder: fires with the full new tab order and the id that
   * moved. The caller persists (server mutation, store update, …). Omit to
   * disable drag-to-reorder.
   */
  onReorder?: (orderedIds: string[], movedId: string) => void
  /**
   * Add a tab via the pending-pill flow: the `+` spawns an empty inline input
   * and this fires with the committed title (never with an empty title). Omit to
   * hide the add button.
   */
  onAdd?: (title: string) => void | Promise<void>
  /** Disables the add button (e.g. a create is already in flight). */
  addDisabled?: boolean
  /**
   * Renders the add trigger. Receives a click handler that opens the pending
   * pill. Omit for the default sticky `+` icon button (KB); dashboards pass a
   * simple inline "Add tab" button here.
   */
  renderAddButton?: (helpers: { onClick: () => void; disabled: boolean }) => ReactNode
  /** Per-tab context-menu items. Receives the tab and helpers (e.g. startRename). */
  renderMenu?: (tab: T, helpers: TabMenuHelpers) => ReactNode
  /**
   * Trailing content inside each pill, after the label (e.g. a hover-reveal
   * delete `×`). Not shown while a pill is being renamed. Handle `onPointerDown`
   * + `onClick` with `stopPropagation` so it doesn't start a drag or select the
   * tab.
   */
  renderTrailing?: (tab: T) => ReactNode
  /** Custom pill label (icons etc.). Defaults to the tab title (or "Untitled"). */
  renderLabel?: (tab: T) => ReactNode
  /** Shown when there are no tabs and no pending add. */
  emptyState?: ReactNode
  /** Placeholder for the inline inputs. Default "Untitled". */
  placeholder?: string
  className?: string
}

/**
 * Horizontal, drag-reorderable tab strip with inline rename and a pending-pill
 * add flow. Presentational — it owns the interaction (dnd, rename input, pending
 * pill) and emits events; the caller owns persistence. Shared by the KB editor
 * and dashboards.
 */
export function TabStrip<T extends TabStripItem>({
  tabs,
  activeTabId,
  onSelect,
  editable = true,
  onRename,
  onReorder,
  onAdd,
  addDisabled,
  renderAddButton,
  renderMenu,
  renderTrailing,
  renderLabel,
  emptyState,
  placeholder = 'Untitled',
  className,
}: TabStripProps<T>) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const pendingRef = useRef<HTMLDivElement>(null)

  const reorderEnabled = editable && !!onReorder
  const addEnabled = editable && !!onAdd
  const renameEnabled = editable && !!onRename

  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {})
  )

  // Scroll the pending pill into view when it appears.
  useEffect(() => {
    if (!pending || !pendingRef.current) return
    const viewport = pendingRef.current.closest<HTMLElement>('[data-slot=scroll-area-viewport]')
    viewport?.scrollTo({ left: viewport.scrollWidth + 10, behavior: 'smooth' })
  }, [pending])

  const handleAddClick = useCallback(() => {
    if (pending || addDisabled) return
    setPending(true)
  }, [pending, addDisabled])

  const handleCommitPending = useCallback(
    async (title: string) => {
      setPending(false)
      await onAdd?.(title)
    },
    [onAdd]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const fromIndex = tabs.findIndex((t) => t.id === active.id)
      const toIndex = tabs.findIndex((t) => t.id === over.id)
      if (fromIndex === -1 || toIndex === -1) return

      const reordered = tabs.slice()
      const [moving] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, moving)
      onReorder?.(
        reordered.map((t) => t.id),
        moving.id
      )
    },
    [tabs, onReorder]
  )

  const pills = (
    <div className='flex items-center gap-0.5'>
      {tabs.length === 0 && !pending ? (
        (emptyState ??
        (addEnabled ? (
          <button
            type='button'
            onClick={handleAddClick}
            disabled={addDisabled}
            className='flex flex-1 items-center justify-center border-b-2 border-transparent py-2 text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
            aria-label='Add first tab'>
            Click to add tab
          </button>
        ) : null))
      ) : (
        <>
          {tabs.map((tab) => (
            <TabPill
              key={tab.id}
              tab={tab}
              active={activeTabId === tab.id}
              isRenaming={renameEnabled && renamingId === tab.id}
              reorderEnabled={reorderEnabled}
              placeholder={placeholder}
              renderLabel={renderLabel}
              renderMenu={editable ? renderMenu : undefined}
              renderTrailing={editable ? renderTrailing : undefined}
              onSelect={() => onSelect(tab.id)}
              onStartRename={renameEnabled ? () => setRenamingId(tab.id) : undefined}
              onFinishRename={() => setRenamingId(null)}
              onCommitRename={(next) => {
                onRename?.(tab.id, next)
                setRenamingId(null)
              }}
            />
          ))}
          {pending && (
            <div
              ref={pendingRef}
              className='inline-flex shrink-0 items-center border-b-2 border-transparent px-1 py-2 text-sm'>
              <RenameInput
                initialValue=''
                placeholder={placeholder}
                onCommit={handleCommitPending}
                onCancel={() => setPending(false)}
                inputClassName='rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-primary'
              />
            </div>
          )}
          {addEnabled &&
            (renderAddButton ? (
              renderAddButton({ onClick: handleAddClick, disabled: pending || addDisabled })
            ) : (
              <div className='sticky right-0 z-10 ml-auto shrink-0 bg-primary-50 pl-2 [mask-image:linear-gradient(to_right,transparent_0,black_8px,black_100%)]'>
                <button
                  type='button'
                  onClick={handleAddClick}
                  disabled={pending || addDisabled || !!activeId}
                  className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                  aria-label='Add tab'>
                  <Plus size={14} />
                </button>
              </div>
            ))}
        </>
      )}
    </div>
  )

  return (
    <div className={cn('flex w-full items-center border-b border-border', className)}>
      <ScrollArea
        orientation='horizontal'
        scrollbarClassName='h-0.5! mb-0!'
        className='flex-1 [&_[data-slot=scroll-area-viewport]]:overscroll-x-none'>
        {reorderEnabled ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}>
            <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
              {pills}
            </SortableContext>
            <DragOverlay>
              {activeTab && (
                <div className='inline-flex items-center border-b-2 border-primary bg-background px-3 py-2 text-sm font-medium text-foreground shadow-md'>
                  {renderLabel ? renderLabel(activeTab) : activeTab.title || placeholder}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          pills
        )}
      </ScrollArea>
    </div>
  )
}

interface TabPillProps<T extends TabStripItem> {
  tab: T
  active: boolean
  isRenaming: boolean
  reorderEnabled: boolean
  placeholder: string
  renderLabel?: (tab: T) => ReactNode
  renderMenu?: (tab: T, helpers: TabMenuHelpers) => ReactNode
  renderTrailing?: (tab: T) => ReactNode
  onSelect: () => void
  onStartRename?: () => void
  onFinishRename: () => void
  onCommitRename: (next: string) => void
}

function TabPill<T extends TabStripItem>({
  tab,
  active,
  isRenaming,
  reorderEnabled,
  placeholder,
  renderLabel,
  renderMenu,
  renderTrailing,
  onSelect,
  onStartRename,
  onFinishRename,
  onCommitRename,
}: TabPillProps<T>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: !reorderEnabled,
  })

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  const label = renderLabel ? renderLabel(tab) : tab.title || placeholder

  const pill = (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      {...attributes}
      {...(isRenaming ? {} : listeners)}
      className={cn(
        'group/tab relative inline-flex shrink-0 items-center border-b-2 border-transparent py-2 text-sm transition-colors',
        isRenaming ? 'px-1.75' : 'px-3',
        active
          ? 'border-primary font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}>
      {isRenaming ? (
        <RenameInput
          initialValue={tab.title}
          placeholder={placeholder}
          onCommit={onCommitRename}
          onCancel={onFinishRename}
          inputClassName='rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-primary'
        />
      ) : (
        <>
          <button type='button' onClick={onSelect} onDoubleClick={onStartRename}>
            {label}
          </button>
          {renderTrailing?.(tab)}
        </>
      )}
    </div>
  )

  if (!renderMenu) return pill

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{pill}</ContextMenuTrigger>
      {renderMenu(tab, { startRename: () => onStartRename?.() })}
    </ContextMenu>
  )
}
