// apps/web/src/components/pickers/reference-picker/reference-picker-content.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'
import { useImperativeHandle, useMemo, useRef } from 'react'
import {
  DEFAULT_TABS,
  type ReferenceTab,
  TAB_LABEL,
} from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { ActorPickerContent } from '../actor-picker/actor-picker-content'
import { ArticleReferenceList } from '../article-picker/article-reference-list'
import { FieldReferenceList } from '../field-picker/field-reference-list'
import { RecordPickerContent } from '../record-picker/record-picker-content'
import { ResourceReferenceList } from '../resource-picker/resource-reference-list'
import { ThreadReferenceList } from '../thread-picker/thread-reference-list'
import { ToolReferenceList } from '../tool-picker/tool-reference-list'
import { useCmdkRemote } from '../use-cmdk-remote'

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

  const remote = useCmdkRemote(containerRef, `${tab}:${query}`)

  useImperativeHandle(
    ref,
    () => ({
      moveHighlight: remote.moveHighlight,
      confirmHighlighted: remote.confirmHighlighted,
    }),
    [remote.moveHighlight, remote.confirmHighlighted]
  )

  const emptyValue = useMemo(() => [] as RecordId[], [])

  return (
    <div ref={containerRef} className={cn('rounded-lg', className)}>
      <div
        className='flex items-center gap-0 border-b px-1 shrink-0 no-scrollbar overflow-x-auto'
        role='tablist'>
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
              'px-2.5 py-1.5 text-xs font-medium rounded-sm transition-colors shrink-0',
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
          <ToolReferenceList
            externalSearch={query}
            onSelectSingle={(id) => onSelect(id as unknown as RecordId)}
          />
        )}
        {tab === 'resources' && (
          <ResourceReferenceList
            externalSearch={query}
            onSelectSingle={(id) => onSelect(id as unknown as RecordId)}
          />
        )}
        {tab === 'fields' && (
          <FieldReferenceList
            externalSearch={query}
            onSelectSingle={(id) => onSelect(id as unknown as RecordId)}
          />
        )}
      </div>
    </div>
  )
}
