// apps/web/src/components/pickers/reference-picker/reference-picker-content.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import {
  DEFAULT_TABS,
  type ReferenceTab,
  TAB_LABEL,
} from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { ActorPickerContent } from '../actor-picker/actor-picker-content'
import { ArticleReferenceList } from '../article-picker/article-reference-list'
import { RecordPickerContent } from '../record-picker/record-picker-content'
import { ThreadReferenceList } from '../thread-picker/thread-reference-list'
import { ToolsetReferenceList } from '../toolset-picker/toolset-reference-list'

export type { ReferenceTab }

export interface ReferencePickerHandle {
  /** Move list highlight up (-1) or down (+1). Returns whether handled. */
  moveHighlight: (direction: 1 | -1) => boolean
  /** Confirm the currently-highlighted item. Returns whether handled. */
  confirmHighlighted: () => boolean
}

export interface ReferencePickerContentProps {
  /** Active tab — driven by the editor chip's `tab` attribute. */
  tab: ReferenceTab
  /** Active search query — driven by the editor chip's text content. */
  query: string
  /** Called on selection — picker is one-shot per open */
  onSelect: (id: RecordId) => void
  /** Called when the user clicks a tab in the strip. */
  onTabChange?: (tab: ReferenceTab) => void
  /** Imperative handle for keyboard nav forwarded from the editor. */
  ref?: React.Ref<ReferencePickerHandle>
  /** Optional className for the outer Command shell */
  className?: string
  /**
   * Tabs to render. Defaults to `DEFAULT_TABS` (the four legacy tabs). Pass
   * `[...DEFAULT_TABS, 'tools']` on admin-facing surfaces (persona editor)
   * to opt into the tools tab. Must match the `tabs` option passed to the
   * paired `ReferencePickerNode` so digit shortcuts / Tab cycling stay in
   * sync with the visible strip.
   */
  tabs?: ReferenceTab[]
}

/**
 * Tab + list shell for `@`-mentions. The editor's `referencePicker` chip
 * owns the source-of-truth state (active tab + query); this component is
 * purely presentational + keyboard forwarder.
 */
export function ReferencePickerContent({
  tab,
  query,
  onSelect,
  onTabChange,
  ref,
  className,
  tabs = DEFAULT_TABS,
}: ReferencePickerContentProps) {
  const noop = useMemo(() => () => {}, [])
  const containerRef = useRef<HTMLDivElement>(null)

  // Each picker child (`ActorPickerContent`, `RecordPickerContent`, …) renders
  // its own `<Command>` internally — so we must NOT wrap them with another
  // one. To drive selection in that inner cmdk root from arrow keys, we
  // dispatch native `pointermove` events on the target item; cmdk's
  // CommandItem reacts to pointer-over by setting itself as selected. This
  // path doesn't require focus on a CommandInput (which would steal focus
  // from the tiptap chip).
  const getEnabledItems = () => {
    const root = containerRef.current?.querySelector('[cmdk-root]')
    if (!root) return [] as HTMLElement[]
    return Array.from(root.querySelectorAll<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])'))
  }

  const selectItemByPointer = (el: HTMLElement) => {
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true }))
    el.scrollIntoView({ block: 'nearest' })
  }

  // Auto-highlight the first visible item whenever the list might have
  // changed. We use a microtask + MutationObserver because the picker
  // children load items asynchronously (react-query).
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const tryHighlight = () => {
      const items = getEnabledItems()
      if (items.length === 0) return
      // Only paint if nothing's selected yet.
      const cmdkRoot = root.querySelector('[cmdk-root]')
      const alreadySelected = cmdkRoot?.querySelector('[cmdk-item][data-selected="true"]')
      if (alreadySelected) return
      selectItemByPointer(items[0]!)
    }
    tryHighlight()
    const mo = new MutationObserver(tryHighlight)
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [tab, query])

  useImperativeHandle(
    ref,
    () => ({
      moveHighlight: (direction: 1 | -1) => {
        const items = getEnabledItems()
        if (items.length === 0) return false
        const currentEl = items.find((el) => el.getAttribute('data-selected') === 'true')
        const currentIdx = currentEl ? items.indexOf(currentEl) : -1
        const nextIdx = (currentIdx + direction + items.length) % items.length
        const next = items[nextIdx]
        if (!next) return false
        selectItemByPointer(next)
        return true
      },
      confirmHighlighted: () => {
        const root = containerRef.current?.querySelector('[cmdk-root]')
        if (!root) return false
        const current = root.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')
        if (!current) return false
        // cmdk's CommandItem wires onSelect to a click handler internally.
        current.click()
        return true
      },
    }),
    []
  )

  const emptyValue = useMemo(() => [] as RecordId[], [])

  return (
    <div ref={containerRef} className={cn('rounded-lg', className)}>
      <div className='flex items-center gap-0 border-b px-1 shrink-0' role='tablist'>
        {tabs.map((t, idx) => (
          <button
            key={t}
            type='button'
            role='tab'
            aria-selected={tab === t}
            onMouseDown={(e) => {
              e.preventDefault()
              onTabChange?.(t)
            }}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium rounded-sm transition-colors',
              tab === t ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'
            )}>
            {TAB_LABEL[t]}
            <span className='ml-1 text-[10px] text-muted-foreground/60'>{idx + 1}</span>
          </button>
        ))}
      </div>
      {/* Pin the inner CommandList to a fixed height so the popover stays the same
          size across tabs and as items load/filter. Targets the `data-slot` on the
          scroll-area Root inside CommandList. */}
      <div className='[&_[data-slot=command-list]]:h-[288px]'>
        {tab === 'people' && (
          <ActorPickerContent
            value={emptyValue as unknown as never[]}
            onChange={noop}
            target='all'
            multi={false}
            onSelectSingle={(actorId) => onSelect(actorId as unknown as RecordId)}
            externalSearch={query}
            showInput={false}
            placeholder='Search people...'
          />
        )}
        {tab === 'records' && (
          <RecordPickerContent
            value={emptyValue}
            onChange={noop}
            multi={false}
            onSelectSingle={(id) => onSelect(id)}
            externalSearch={query}
            showInput={false}
            placeholder='Search records...'
          />
        )}
        {tab === 'messages' && (
          <ThreadReferenceList
            value={emptyValue}
            onChange={noop}
            multi={false}
            onSelectSingle={(id) => onSelect(id)}
            externalSearch={query}
            showInput={false}
          />
        )}
        {tab === 'articles' && (
          <ArticleReferenceList
            value={emptyValue}
            onChange={noop}
            multi={false}
            onSelectSingle={(id) => onSelect(id)}
            externalSearch={query}
            showInput={false}
          />
        )}
        {tab === 'tools' && (
          <ToolsetReferenceList
            externalSearch={query}
            onSelectSingle={(id) => onSelect(id as unknown as RecordId)}
          />
        )}
      </div>
    </div>
  )
}
