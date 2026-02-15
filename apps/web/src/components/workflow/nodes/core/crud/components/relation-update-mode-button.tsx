// apps/web/src/components/workflow/nodes/core/crud/components/relation-update-mode-button.tsx

'use client'

import {
  RELATION_UPDATE_MODES,
  RelationUpdateMode,
  type RelationUpdateMode as RelationUpdateModeType,
} from '@auxx/types/custom-field'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'

/** Mode display configuration */
const MODE_CONFIG: Record<
  RelationUpdateModeType,
  { letter: string; label: string; className: string }
> = {
  [RelationUpdateMode.REPLACE]: {
    letter: 'R',
    label: 'Replace',
    className: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  },
  [RelationUpdateMode.ADD]: {
    letter: 'A',
    label: 'Add',
    className: 'bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  },
  [RelationUpdateMode.REMOVE]: {
    letter: 'R',
    label: 'Remove',
    className: 'bg-red-500/15 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  },
  [RelationUpdateMode.DYNAMIC]: {
    letter: 'D',
    label: 'Dynamic',
    className: 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  },
}

/** Runtime modes available for dynamic variable resolution (excludes 'dynamic' itself) */
const RUNTIME_MODE_OPTIONS = RELATION_UPDATE_MODES.filter(
  (m) => m !== RelationUpdateMode.DYNAMIC
).map((m) => ({ label: MODE_CONFIG[m].label, value: m }))

interface RelationUpdateModeButtonProps {
  /** Current update mode */
  mode: RelationUpdateModeType
  /** Called when mode changes (cycle click) */
  onChange: (mode: RelationUpdateModeType) => void
  /** Node ID for VarEditor context (needed for dynamic mode popover) */
  nodeId: string
  /** Current dynamic mode variable value */
  dynamicModeVar?: string
  /** Called when dynamic mode variable changes */
  onDynamicModeVarChange?: (value: string) => void
}

/**
 * Inline badge button that shows the current relation update mode.
 * Rendered to the left of the VarEditor's constant/dynamic toggle.
 *
 * Interaction:
 * - Left-click always cycles to next mode (replace → add → remove → dynamic → replace)
 * - When cycling onto dynamic, the popover auto-opens for variable selection
 * - Right-click on dynamic badge toggles the popover for reconfiguring
 */
const RelationUpdateModeButton: React.FC<RelationUpdateModeButtonProps> = ({
  mode,
  onChange,
  nodeId,
  dynamicModeVar,
  onDynamicModeVarChange,
}) => {
  const config = MODE_CONFIG[mode]
  const isDynamic = mode === RelationUpdateMode.DYNAMIC
  const [popoverOpen, setPopoverOpen] = useState(false)
  const prevModeRef = useRef(mode)

  // Auto-open popover when cycling onto dynamic mode
  useEffect(() => {
    if (mode === RelationUpdateMode.DYNAMIC && prevModeRef.current !== RelationUpdateMode.DYNAMIC) {
      setPopoverOpen(true)
    }
    prevModeRef.current = mode
  }, [mode])

  /** Left-click always cycles to next mode */
  const handleClick = useCallback(() => {
    const currentIndex = RELATION_UPDATE_MODES.indexOf(mode)
    const nextIndex = (currentIndex + 1) % RELATION_UPDATE_MODES.length
    onChange(RELATION_UPDATE_MODES[nextIndex])
  }, [mode, onChange])

  /** Right-click on dynamic badge toggles the popover */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (isDynamic) {
        e.preventDefault()
        setPopoverOpen((prev) => !prev)
      }
    },
    [isDynamic]
  )

  const badge = (
    <button
      type='button'
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={cn(
        'group/mode',
        'flex h-5 shrink-0 items-center rounded-md px-1',
        'text-[10px] font-semibold uppercase leading-none',
        'cursor-pointer select-none',
        'overflow-hidden whitespace-nowrap',
        'transition-all duration-200 ease-out',
        config.className
      )}>
      <span
        className={cn(
          'inline-block overflow-hidden whitespace-nowrap',
          'max-w-[7px] transition-all duration-200 ease-out',
          'group-hover/mode:max-w-20'
        )}>
        {config.label}
      </span>
    </button>
  )

  // Always wrap in Popover when in dynamic mode (popover controlled by state)
  if (isDynamic) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>{badge}</PopoverTrigger>
        <PopoverContent
          side='bottom'
          align='end'
          className='w-64 p-2'
          onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className='space-y-1.5'>
            <p className='text-xs font-medium text-primary-600'>Mode Variable</p>
            <VarEditor
              nodeId={nodeId}
              value={dynamicModeVar ?? ''}
              onChange={(val) => onDynamicModeVarChange?.(val)}
              varType={BaseType.ENUM}
              fieldOptions={{ enum: RUNTIME_MODE_OPTIONS }}
              mode={VAR_MODE.PICKER}
              allowConstant={false}
              placeholder='Select mode variable'
            />
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  return badge
}

export { RelationUpdateModeButton }
