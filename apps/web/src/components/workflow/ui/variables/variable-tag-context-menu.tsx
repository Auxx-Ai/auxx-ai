// apps/web/src/components/workflow/ui/variables/variable-tag-context-menu.tsx

'use client'

import { setSegmentAccessor } from '@auxx/lib/workflow-engine/client'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '@auxx/ui/components/context-menu'
import { Input } from '@auxx/ui/components/input'
import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import {
  getAccessorLabel,
  useVariableArraySegments,
  type VariableArraySegment,
} from './use-variable-array-segments'

/**
 * Accessor options offered for a segment.
 *
 * `null` (the array itself) is offered **only on a terminal segment** —
 * stripping a bracket mid-path leaves `orders.sku`, i.e. dotting into an array.
 *
 * A terminal segment deliberately does NOT offer `[*]`. At the end of a path a
 * wildcard returns the array unmapped (`ExecutionContextManager.walkProjection`
 * returns `items` when nothing follows), so `X` and `X[*]` are the same value —
 * but `X` is declared `ARRAY` while `X[*]` is the item's shape, and the item
 * shape is the wrong answer for every array-accepting input. Offering both
 * would be two identical-looking options where one silently mistypes.
 */
function accessorOptions(segment: VariableArraySegment): (string | null)[] {
  return segment.isTerminal ? [null, '0', '-1'] : ['*', '0', '-1']
}

type VariableTagContextMenuProps = {
  variableId: string
  onVariableIdChange?: (newId: string) => void
  children: React.ReactNode
}

/**
 * Right-click menu for changing how each array in a variable's path is accessed.
 *
 * Renders nothing when the path has no arrays — the chip falls through to the
 * browser's own menu rather than showing an empty or disabled panel.
 */
export function VariableTagContextMenu({
  variableId,
  onVariableIdChange,
  children,
}: VariableTagContextMenuProps) {
  const segments = useVariableArraySegments(variableId)

  if (segments.length === 0 || !onVariableIdChange) {
    return <>{children}</>
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className='inline-flex'>{children}</span>
      </ContextMenuTrigger>
      <ContextMenuContent
        className='w-64'
        // Radix portals this content to `document.body`, but React synthetic
        // events propagate along the REACT tree — where it is still a descendant
        // of whatever wraps the chip. Every consumer wraps the chip in a
        // `PopoverTrigger` (the variable explorer), so without this, clicking any
        // row in here bubbles out and toggles that popover open on top of us.
        onClick={(e) => e.stopPropagation()}>
        <ArrayAccessPanel
          segments={segments}
          variableId={variableId}
          onVariableIdChange={onVariableIdChange}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Inline accordion over the path's arrays.
 *
 * Every array is listed by name with its current selection; clicking one expands
 * its options in place below it, one at a time. A single array is always
 * expanded, so the common case stays one click deep.
 *
 * The menu deliberately stays open across selections — with several arrays in a
 * path you routinely set two accessors in one visit. That is what every
 * `onSelect`'s `preventDefault` buys.
 */
function ArrayAccessPanel({
  segments,
  variableId,
  onVariableIdChange,
}: {
  segments: VariableArraySegment[]
  variableId: string
  onVariableIdChange: (newId: string) => void
}) {
  const isSingle = segments.length === 1
  // Keyed on `ordinal`, never `basePath`: editing one accessor rewrites the ids
  // of every segment after it, so a basePath key would collapse or jump the
  // accordion on each selection.
  const [expandedOrdinal, setExpandedOrdinal] = useState<number | null>(0)

  return (
    <>
      <ContextMenuLabel className='text-xs text-muted-foreground'>Array access</ContextMenuLabel>

      {segments.map((segment) => {
        const isExpanded = isSingle || expandedOrdinal === segment.ordinal

        return (
          <Fragment key={segment.ordinal}>
            {isSingle ? (
              <ContextMenuLabel className='flex items-center justify-between gap-2 font-medium'>
                <span className='truncate'>{segment.label}</span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {getAccessorLabel(segment.accessor)}
                </span>
              </ContextMenuLabel>
            ) : (
              <ContextMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setExpandedOrdinal(isExpanded ? null : segment.ordinal)
                }}>
                <div className='flex w-full items-center gap-2'>
                  {isExpanded ? (
                    <ChevronDown className='size-3.5 shrink-0 opacity-60' />
                  ) : (
                    <ChevronRight className='size-3.5 shrink-0 opacity-60' />
                  )}
                  <span className='truncate font-medium'>{segment.label}</span>
                  <span className='ml-auto shrink-0 text-xs text-muted-foreground'>
                    {getAccessorLabel(segment.accessor)}
                  </span>
                </div>
              </ContextMenuItem>
            )}

            {isExpanded && (
              <SegmentOptions
                segment={segment}
                variableId={variableId}
                onVariableIdChange={onVariableIdChange}
                indented={!isSingle}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

/** The expanded option list for one array segment. */
function SegmentOptions({
  segment,
  variableId,
  onVariableIdChange,
  indented,
}: {
  segment: VariableArraySegment
  variableId: string
  onVariableIdChange: (newId: string) => void
  indented: boolean
}) {
  const [showCustomIndex, setShowCustomIndex] = useState(false)
  const [customIndex, setCustomIndex] = useState('')

  const options = accessorOptions(segment)
  const isCustom = segment.accessor !== null && !options.includes(segment.accessor)

  const select = (accessor: string | null) => {
    setShowCustomIndex(false)
    setCustomIndex('')
    onVariableIdChange(setSegmentAccessor(variableId, segment.basePath, accessor))
  }

  const submitCustom = () => {
    const parsed = Number.parseInt(customIndex, 10)
    if (!Number.isNaN(parsed)) select(String(parsed))
  }

  return (
    <div className={cn(indented && 'ml-3 border-l pl-1')}>
      {options.map((accessor) => (
        <OptionRow
          key={accessor ?? 'bare'}
          checked={segment.accessor === accessor}
          onSelect={() => select(accessor)}
          hint={accessor === null ? undefined : `[${accessor}]`}>
          {getAccessorLabel(accessor)}
        </OptionRow>
      ))}

      {isCustom && (
        <OptionRow checked hint={`[${segment.accessor}]`}>
          {getAccessorLabel(segment.accessor)}
        </OptionRow>
      )}

      {showCustomIndex ? (
        <div className='px-2 py-1.5'>
          <Input
            type='number'
            placeholder='Enter index...'
            value={customIndex}
            onChange={(e) => setCustomIndex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitCustom()
              }
              // The menu's typeahead would otherwise swallow the digits.
              e.stopPropagation()
            }}
            className='h-7 text-xs'
            autoFocus
          />
        </div>
      ) : (
        <OptionRow checked={false} onSelect={() => setShowCustomIndex(true)}>
          Specific index...
        </OptionRow>
      )}
    </div>
  )
}

/**
 * One selectable accessor. `preventDefault` is what keeps the menu open after a
 * selection — without it Radix dismisses on every activation.
 */
function OptionRow({
  checked,
  onSelect,
  hint,
  children,
}: {
  checked?: boolean
  onSelect?: () => void
  hint?: string
  children: React.ReactNode
}) {
  return (
    <ContextMenuItem
      onSelect={(e) => {
        e.preventDefault()
        onSelect?.()
      }}>
      <div className='flex w-full items-center gap-2'>
        <span className='truncate'>{children}</span>
        {hint && <span className='ml-auto text-xs text-muted-foreground'>{hint}</span>}
        {checked && (
          <div
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full border border-blue-800 bg-info',
              !hint && 'ml-auto'
            )}>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </div>
        )}
      </div>
    </ContextMenuItem>
  )
}
