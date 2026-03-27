// apps/web/src/components/workflow/ui/variables/variable-tag-context-menu.tsx

'use client'

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@auxx/ui/components/context-menu'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  type ArraySegmentInfo,
  getArrayAccessorMenuLabel,
  parseArraySegmentsFromId,
  replaceArrayAccessor,
} from '~/components/workflow/utils/variable-utils'

/** Standard accessor options shown in the menu */
const STANDARD_ACCESSORS = [
  { value: '*', label: 'All items' },
  { value: '0', label: 'First item' },
  { value: '-1', label: 'Last item' },
] as const

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

type ArrayAccessorMenuProps = {
  variableId: string
  onVariableIdChange?: (newId: string) => void
  children: React.ReactNode
}

// ---------------------------------------------------------------------------
// Right-click context menu variant
// ---------------------------------------------------------------------------

/**
 * Context menu wrapper for variable tags that contain array segments.
 * Right-click shows accessor options per array segment in the variable path.
 */
export function VariableTagContextMenu({
  variableId,
  onVariableIdChange,
  children,
}: ArrayAccessorMenuProps) {
  const arraySegments = useMemo(() => parseArraySegmentsFromId(variableId), [variableId])

  if (arraySegments.length === 0 || !onVariableIdChange) {
    return <>{children}</>
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className='inline-flex'>{children}</span>
      </ContextMenuTrigger>
      <ContextMenuContent className='w-56'>
        <div onClick={(e) => e.stopPropagation()}>
          {arraySegments.map((seg, i) => (
            <ContextMenuSegmentSection
              key={`${seg.path}-${i}`}
              segment={seg}
              variableId={variableId}
              onVariableIdChange={onVariableIdChange}
              showSeparator={i < arraySegments.length - 1}
            />
          ))}
        </div>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Context menu section for a single array segment */
function ContextMenuSegmentSection({
  segment,
  variableId,
  onVariableIdChange,
  showSeparator,
}: {
  segment: ArraySegmentInfo
  variableId: string
  onVariableIdChange: (newId: string) => void
  showSeparator: boolean
}) {
  const [showCustomIndex, setShowCustomIndex] = useState(false)
  const [customIndex, setCustomIndex] = useState('')

  const isCustomAccessor =
    segment.accessor !== '*' && segment.accessor !== '0' && segment.accessor !== '-1'

  const handleSelect = (newAccessor: string) => {
    setShowCustomIndex(false)
    setCustomIndex('')
    const newId = replaceArrayAccessor(variableId, segment.path, newAccessor)
    onVariableIdChange(newId)
  }

  const handleCustomSubmit = () => {
    const parsed = Number.parseInt(customIndex, 10)
    if (!Number.isNaN(parsed)) {
      handleSelect(String(parsed))
    }
  }

  return (
    <>
      <ContextMenuLabel className='text-xs text-muted-foreground'>
        "{segment.label}" access
      </ContextMenuLabel>

      {STANDARD_ACCESSORS.map((opt) => (
        <ContextMenuCheckboxItem
          key={opt.value}
          multi={false}
          checked={segment.accessor === opt.value}
          onSelect={(e) => {
            e.preventDefault()
            handleSelect(opt.value)
          }}>
          {opt.label}
          <span className='ml-auto text-xs text-muted-foreground'>[{opt.value}]</span>
        </ContextMenuCheckboxItem>
      ))}

      {isCustomAccessor && (
        <ContextMenuCheckboxItem multi={false} checked>
          {getArrayAccessorMenuLabel(segment.accessor)}
          <span className='ml-auto text-xs text-muted-foreground'>[{segment.accessor}]</span>
        </ContextMenuCheckboxItem>
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
                handleCustomSubmit()
              }
              e.stopPropagation()
            }}
            className='h-7 text-xs'
            autoFocus
          />
        </div>
      ) : (
        <ContextMenuCheckboxItem
          multi={false}
          checked={false}
          onSelect={(e) => {
            e.preventDefault()
            setShowCustomIndex(true)
          }}>
          Specific index...
        </ContextMenuCheckboxItem>
      )}

      {showSeparator && <ContextMenuSeparator />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Left-click dropdown variant
// ---------------------------------------------------------------------------

/**
 * Dropdown (popover) wrapper for variable tags that contain array segments.
 * Left-click shows accessor options per array segment in the variable path.
 */
export function VariableTagDropdown({
  variableId,
  onVariableIdChange,
  children,
}: ArrayAccessorMenuProps) {
  const [open, setOpen] = useState(false)
  const arraySegments = useMemo(() => parseArraySegmentsFromId(variableId), [variableId])

  if (arraySegments.length === 0 || !onVariableIdChange) {
    return <>{children}</>
  }

  const handleChange = (newId: string) => {
    onVariableIdChange(newId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className='inline-flex cursor-pointer'>{children}</span>
      </PopoverTrigger>
      <PopoverContent
        side='bottom'
        align='start'
        className='w-56 p-1'
        onOpenAutoFocus={(e) => e.preventDefault()}>
        {arraySegments.map((seg, i) => (
          <DropdownSegmentSection
            key={`${seg.path}-${i}`}
            segment={seg}
            variableId={variableId}
            onVariableIdChange={handleChange}
            showSeparator={i < arraySegments.length - 1}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** Dropdown section for a single array segment */
function DropdownSegmentSection({
  segment,
  variableId,
  onVariableIdChange,
  showSeparator,
}: {
  segment: ArraySegmentInfo
  variableId: string
  onVariableIdChange: (newId: string) => void
  showSeparator: boolean
}) {
  const [showCustomIndex, setShowCustomIndex] = useState(false)
  const [customIndex, setCustomIndex] = useState('')

  const isCustomAccessor =
    segment.accessor !== '*' && segment.accessor !== '0' && segment.accessor !== '-1'

  const handleSelect = (newAccessor: string) => {
    setShowCustomIndex(false)
    setCustomIndex('')
    const newId = replaceArrayAccessor(variableId, segment.path, newAccessor)
    onVariableIdChange(newId)
  }

  const handleCustomSubmit = () => {
    const parsed = Number.parseInt(customIndex, 10)
    if (!Number.isNaN(parsed)) {
      handleSelect(String(parsed))
    }
  }

  return (
    <>
      <div className='px-2 py-1.5 text-xs font-semibold text-muted-foreground'>
        "{segment.label}" access
      </div>

      {STANDARD_ACCESSORS.map((opt) => (
        <DropdownCheckItem
          key={opt.value}
          checked={segment.accessor === opt.value}
          onSelect={() => handleSelect(opt.value)}>
          {opt.label}
          <span className='ml-auto text-xs text-muted-foreground'>[{opt.value}]</span>
        </DropdownCheckItem>
      ))}

      {isCustomAccessor && (
        <DropdownCheckItem checked>
          {getArrayAccessorMenuLabel(segment.accessor)}
          <span className='ml-auto text-xs text-muted-foreground'>[{segment.accessor}]</span>
        </DropdownCheckItem>
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
                handleCustomSubmit()
              }
              e.stopPropagation()
            }}
            className='h-7 text-xs'
            autoFocus
          />
        </div>
      ) : (
        <DropdownCheckItem checked={false} onSelect={() => setShowCustomIndex(true)}>
          Specific index...
        </DropdownCheckItem>
      )}

      {showSeparator && <div className='-mx-1 my-1 h-px bg-border' />}
    </>
  )
}

/** Simple check item for the dropdown variant — mirrors ContextMenuCheckboxItem with multi=false */
function DropdownCheckItem({
  checked,
  onSelect,
  children,
}: {
  checked?: boolean
  onSelect?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      className={cn(
        'relative flex w-full cursor-default select-none items-center justify-between rounded-full px-2 py-1 text-sm outline-hidden transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground'
      )}
      onClick={onSelect}>
      <div className='flex items-center gap-2'>{children}</div>
      {checked && (
        <div className='flex size-4 items-center justify-center rounded-full border border-blue-800 bg-info'>
          <Check className='size-2.5! text-white' strokeWidth={4} />
        </div>
      )}
    </button>
  )
}
