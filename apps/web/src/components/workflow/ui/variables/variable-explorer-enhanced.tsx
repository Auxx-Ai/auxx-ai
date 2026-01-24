// apps/web/src/components/workflow/ui/variables/variable-explorer-enhanced.tsx

'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useDebounce } from '~/components/workflow/hooks/use-variable-performance'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import type { UnifiedVariable, VariableGroup } from '~/components/workflow/types'
import { useAvailableVariables } from '~/components/workflow/hooks'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@auxx/ui/components/command'
import { Variable, ChevronRight, ChevronLeft, Copy, Star, Search } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { TooltipExplanation } from '~/components/global/tooltip'
import {
  getPathFromVariableId,
  isVariableTypeCompatible,
  hasCompatibleChildPath,
  getVariableDisplayType,
  getVariableRelationship,
} from '~/components/workflow/utils/variable-utils'
import { isNavigableVariable } from '~/components/workflow/utils/variable-conversion'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import { useStore } from '@xyflow/react'
import { useResourceStore } from '~/components/resources/store/resource-store'

// Constants
const CONSTANTS = {
  DEBOUNCE_MS: 300,
  DEFAULT_MAX_HEIGHT: 400,
  FOCUS_DELAY_MS: 0,
  CMDK_ROOT_SELECTOR: '[cmdk-root]' as const,
} as const

const ERROR_MESSAGES = {
  INVALID_TYPE: 'Invalid variable type',
  TYPE_MISMATCH: (expected: string, actual: string) =>
    `This field requires ${expected}, but you selected ${actual}`,
  CANNOT_SELECT: (type: string) => `Variables of type "${type}" cannot be selected here`,
} as const

// Helper function to extract children from a variable
const extractVariableChildren = (variable: UnifiedVariable | undefined): UnifiedVariable[] => {
  if (!variable) return []

  // Prefer properties for object types
  if (variable.properties) {
    return Object.values(variable.properties)
  }

  // Handle array items
  if (variable.items) {
    return [variable.items]
  }

  return []
}

// Remove local VariableGroup interface - we'll use the one from useAvailableVariables

interface NavigationItem {
  id: string // Variable/group ID to look up dynamically
  label: string // Display label
  type: 'group' | 'variable' // Removed 'root' (unused)
  icon?: React.ReactNode
  // Removed 'path' - redundant with 'id'
  // Removed 'variables' - look up dynamically to avoid stale data
}

interface VariableExplorerEnhancedProps {
  onVariableSelect: (variable: UnifiedVariable) => void
  selectedVariables?: string[]
  selected?: string | null // The currently selected variable path (e.g., "message.subject")
  allowedTypes?: string[] // Array of allowed BaseType values (e.g., [BaseType.STRING])
  className?: string
  placeholder?: string
  maxHeight?: number
  nodeId: string // Optional nodeId for context
  onClose?: () => void // Callback to close the picker (e.g., when pressing Backspace with empty search at root)
}

/**
 * Variable Explorer Enhanced
 *
 * Provides an interactive UI for browsing and selecting workflow variables with advanced features:
 * - Hierarchical navigation through nested variable structures (objects, arrays)
 * - Real-time search across all variables (including nested properties)
 * - Favorites and recent variables tracking
 * - Type filtering for validation
 * - Keyboard navigation support
 *
 * Data Flow:
 * - Receives `allVariables` (flattened list) from useAvailableVariables hook for search
 * - Receives `groups` for root-level organization by category (node/env/system)
 * - Navigation dynamically looks up children by ID (no stale snapshots)
 *
 * Performance Optimizations:
 * - Debounced search (300ms)
 * - Memoized computed values
 * - No redundant flattening (uses pre-flattened data from store)
 *
 * @param onVariableSelect - Callback when variable is selected
 * @param selectedVariables - Array of currently selected variable IDs
 * @param selected - Currently highlighted variable ID (for auto-navigation)
 * @param allowedTypes - Optional type filter (e.g., [BaseType.STRING])
 * @param nodeId - Node context for upstream variable validation
 * @param className - Optional CSS class
 * @param placeholder - Search input placeholder
 * @param maxHeight - Maximum height in pixels
 */
export const VariableExplorerEnhanced: React.FC<VariableExplorerEnhancedProps> = ({
  onVariableSelect,
  selectedVariables = [],
  selected = null,
  allowedTypes = [],
  className,
  placeholder = 'Search variables...',
  maxHeight = CONSTANTS.DEFAULT_MAX_HEIGHT,
  nodeId,
  onClose,
}) => {
  // State
  const [search, setSearch] = useState('')
  const [navigationStack, setNavigationStack] = useState<NavigationItem[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [hasManuallyNavigated, setHasManuallyNavigated] = useState(false)
  const commandRef = useRef<HTMLDivElement>(null)

  const { variables, groups, allVariables } = useAvailableVariables({ nodeId })

  // Get nodes from React Flow store for loop context resolution
  const nodes = useStore((state) => state.nodes)

  // Performance optimizations
  const debouncedSearch = useDebounce(search, CONSTANTS.DEBOUNCE_MS)

  // Custom search function for UnifiedVariable
  const searchVariables = useCallback(
    (vars: UnifiedVariable[], searchTerm: string): UnifiedVariable[] => {
      if (!searchTerm.trim()) {
        return vars
      }

      const searchLower = searchTerm.toLowerCase()
      return vars.filter((variable) => {
        const varPath = getPathFromVariableId(variable.id)
        return (
          (variable.label || '').toLowerCase().includes(searchLower) ||
          varPath.toLowerCase().includes(searchLower) ||
          (variable.description || '').toLowerCase().includes(searchLower) ||
          variable.id.toLowerCase().includes(searchLower) || // Search by full ID
          variable.type.toLowerCase().includes(searchLower)
        )
      })
    },
    []
  )

  // Check if a variable is navigable (use utility function)
  const isNavigable = isNavigableVariable

  // Check if a variable type is allowed for selection
  const isTypeAllowed = useCallback(
    (variable: UnifiedVariable): boolean => {
      // Use the new relationship-aware type compatibility utility
      return isVariableTypeCompatible(variable, allowedTypes)
    },
    [allowedTypes]
  )

  // Get raw items at current navigation level
  const rawItems = useMemo(() => {
    // If at root level, return groups
    if (navigationStack.length === 0) {
      return groups
    }

    // Return items at current navigation level (look up dynamically)
    const currentLevel = navigationStack[navigationStack.length - 1]

    if (currentLevel.type === 'group') {
      // Look up group by ID
      const group = groups.find((g) => g.id === currentLevel.id)
      return group?.variables || []
    }

    // Look up variable by ID and get its children
    const variable = allVariables.find((v) => v.id === currentLevel.id)
    return extractVariableChildren(variable)
  }, [navigationStack, groups, allVariables])

  // Apply search filtering to items
  const searchedItems = useMemo(() => {
    if (!debouncedSearch) return rawItems
    return searchVariables(allVariables, debouncedSearch)
  }, [rawItems, debouncedSearch, allVariables, searchVariables])

  // Get current level items (no filtering - items will be shown as disabled via isSelectable)
  const getCurrentLevelItems = useMemo(() => {
    return searchedItems
  }, [searchedItems])

  // Navigation functions
  const navigateInto = useCallback(
    (item: UnifiedVariable | VariableGroup) => {
      const isGroup = 'variables' in item

      const navItem: NavigationItem = {
        id: item.id,
        label: isGroup ? item.name : item.label, // Groups have 'name', variables have 'label'
        type: isGroup ? 'group' : 'variable',
        icon: isGroup ? item.icon : undefined,
      }

      setNavigationStack([...navigationStack, navItem])
      setSearch('') // Clear search when navigating
      setSelectedItemId(null) // Reset selection
      setHasManuallyNavigated(true) // Mark as manually navigated
    },
    [navigationStack]
  )

  const navigateBack = useCallback(() => {
    if (navigationStack.length > 0) {
      setNavigationStack(navigationStack.slice(0, -1))
      setSelectedItemId(null) // Reset selection
      setHasManuallyNavigated(true)
    }
  }, [navigationStack])

  const navigateToBreadcrumb = useCallback(
    (index: number) => {
      setNavigationStack(navigationStack.slice(0, index + 1))
      setSelectedItemId(null) // Reset selection
      setHasManuallyNavigated(true)
    },
    [navigationStack]
  )

  // Handle variable selection
  const handleVariableSelect = useCallback(
    (variable: UnifiedVariable) => {
      let finalVariable = variable

      // Try to convert array[*] notation to loop.item if inside a loop
      // const convertedVariable = convertArrayWildcardToLoopItem(variable, nodeId, nodes)

      // if (convertedVariable) {
      //   finalVariable = convertedVariable

      //   // Show helpful toast notification
      //   toastInfo({
      //     title: 'Using loop variable',
      //     description: `Converted to {{${finalVariable.id}}} for proper type safety`,
      //   })
      // }

      // Call parent handler with final variable (converted or original)
      onVariableSelect(finalVariable)
    },
    [onVariableSelect, nodeId, nodes]
  )

  // Copy variable
  const copyVariable = useCallback((variable: UnifiedVariable, event: React.MouseEvent) => {
    event.stopPropagation()
    const reference = `{{${variable.id}}}`
    navigator.clipboard.writeText(reference)
    toastSuccess({ title: 'Copied!', description: `Variable reference copied to clipboard` })
  }, [])

  /**
   * Get human-readable label for expected type
   */
  const getExpectedTypeLabel = useCallback((type: BaseType | string | undefined): string => {
    if (!type) return ''
    if (typeof type !== 'string') return type
    return useResourceStore.getState().resourceMap.get(type)?.label || type
  }, [])

  /**
   * Show standardized error toast for type mismatches
   */
  const showTypeErrorToast = useCallback(
    (variable: UnifiedVariable) => {
      const displayType = getVariableDisplayType(variable)
      const relationship = getVariableRelationship(variable)
      const targetTable = relationship?.relatedEntityDefinitionId
      const expectedType = allowedTypes[0]
      const expectedLabel = getExpectedTypeLabel(expectedType)

      toastError({
        title: ERROR_MESSAGES.INVALID_TYPE,
        description:
          targetTable && expectedLabel
            ? ERROR_MESSAGES.TYPE_MISMATCH(expectedLabel, displayType)
            : ERROR_MESSAGES.CANNOT_SELECT(displayType),
      })
    },
    [allowedTypes, getExpectedTypeLabel]
  )

  /**
   * Handle variable selection or navigation action
   * Centralizes logic for both Enter key and click handlers
   */
  const handleVariableAction = useCallback(
    (variable: UnifiedVariable): void => {
      const isNav = isNavigable(variable)
      const isAllowed = isTypeAllowed(variable)
      const hasCompatibleChildren = hasCompatibleChildPath(variable, allowedTypes)

      // Allow selection of type-compatible variables
      if (isAllowed) {
        handleVariableSelect(variable)
        return
      }

      // Allow navigation into objects with compatible children
      if (isNav && hasCompatibleChildren) {
        navigateInto(variable)
        return
      }

      // Show error for invalid selections
      showTypeErrorToast(variable)
    },
    [allowedTypes, isTypeAllowed, handleVariableSelect, navigateInto, showTypeErrorToast]
  )

  // Focus command root - reusable helper to restore focus after actions
  const focusCommandRoot = useCallback(() => {
    setTimeout(() => {
      const cmdRoot = commandRef.current?.querySelector(CONSTANTS.CMDK_ROOT_SELECTOR) as HTMLElement
      cmdRoot?.focus()
    }, CONSTANTS.FOCUS_DELAY_MS)
  }, [])

  // Build navigation stack from variable ID path
  const buildNavigationStack = useCallback(
    (variableId: string, allVariables: UnifiedVariable[]): NavigationItem[] => {
      const pathParts = variableId.split('.')
      const stack: NavigationItem[] = []

      for (let i = 0; i < pathParts.length - 1; i++) {
        const currentId = pathParts.slice(0, i + 1).join('.')
        const variable = allVariables.find((v) => v.id === currentId)

        if (variable && isNavigable(variable)) {
          stack.push({
            id: variable.id,
            label: variable.label,
            type: 'variable',
          })
        }
      }

      return stack
    },
    []
  )

  /**
   * Build a human-readable label path for a variable (used in search mode)
   * e.g., "Resource Trigger › dataset" instead of "resource-trigger-xxx › dataset"
   */
  const buildLabelPath = useCallback(
    (variable: UnifiedVariable): string => {
      const pathParts = variable.id.split('.')
      if (pathParts.length <= 1) return ''

      const labels: string[] = []

      // First segment: look up in groups to get node name
      const nodeId = pathParts[0]
      const group = groups.find((g) => g.id === nodeId)
      if (group) {
        labels.push(group.name)
      }

      // Middle segments: look up variables to get labels
      for (let i = 1; i < pathParts.length - 1; i++) {
        const currentId = pathParts.slice(0, i + 1).join('.')
        const parentVar = allVariables.find((v) => v.id === currentId)
        if (parentVar) {
          labels.push(parentVar.label)
        }
      }

      return labels.join(' › ')
    },
    [groups, allVariables]
  )
  // Navigate to selected variable on mount or when selected changes
  useEffect(() => {
    if (!selected || hasManuallyNavigated) return

    const navStack = buildNavigationStack(selected, allVariables)
    if (navStack.length > 0) {
      setNavigationStack(navStack)
    }
  }, [selected, hasManuallyNavigated, allVariables, buildNavigationStack])

  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden', className)}>
      <Command
        ref={commandRef}
        shouldFilter={false}
        onValueChange={(value) => {
          setSelectedItemId(value)
        }}
        onKeyDown={(e) => {
          // Handle navigation keys regardless of which element has focus
          if (e.key === 'ArrowLeft' && navigationStack.length > 0) {
            e.preventDefault()
            e.stopPropagation()
            navigateBack()
            focusCommandRoot()
          } else if (e.key === 'ArrowRight') {
            // Find the currently selected item using Command's internal state
            const selectedElement = commandRef.current?.querySelector('[data-selected="true"]')

            if (selectedElement) {
              const itemId = selectedElement.getAttribute('data-value')
              const item = getCurrentLevelItems.find((i) => i.id === itemId)

              if (item) {
                const isGroup = 'variables' in item
                const isNav = isGroup || isNavigable(item as UnifiedVariable)

                if (isNav) {
                  e.preventDefault()
                  e.stopPropagation()
                  navigateInto(item)
                  focusCommandRoot()
                }
              }
            }
          } else if (e.key === 'Enter') {
            // Handle Enter key press
            const selectedElement = commandRef.current?.querySelector('[data-selected="true"]')

            if (selectedElement) {
              e.preventDefault()
              e.stopPropagation()

              const itemId = selectedElement.getAttribute('data-value')
              const item = getCurrentLevelItems.find((i) => i.id === itemId)

              if (item) {
                const isGroup = 'variables' in item

                if (isGroup) {
                  navigateInto(item)
                } else {
                  handleVariableAction(item as UnifiedVariable)
                }

                focusCommandRoot()
              }
            }
          } else if (e.key === 'Backspace' && search === '') {
            // Handle Backspace with empty search
            if (navigationStack.length > 0) {
              // Navigate back if in nested view
              e.preventDefault()
              e.stopPropagation()
              navigateBack()
              focusCommandRoot()
            } else if (onClose) {
              // Close popover if at root level
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }
          }
        }}>
        {/* Search and Filters */}
        <CommandInput
          placeholder={placeholder}
          value={search}
          onValueChange={setSearch}
          autoFocus
        />

        {search ? (
          <div className="h-9 bg-neutral-50 dark:bg-primary-500/50 flex items-center px-1 border-b shrink-0 backdrop-blur-sm">
            <Button variant="ghost" size="xs" onClick={() => setSearch('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <div className="flex items-center border-b px-1 py-1 bg-neutral-100/50 dark:bg-primary-200/50 h-9 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={navigationStack.length === 0}
              onClick={() => {
                navigateBack()
              }}>
              <ChevronLeft className="size-4!" />
            </Button>

            <div className="flex items-center overflow-x-auto no-scrollbar">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNavigationStack([])
                  setHasManuallyNavigated(true)
                }}>
                All Variables
              </Button>

              {navigationStack.map((item, index) => (
                <div key={item.id} className="flex items-center shrink-0">
                  <ChevronRight className="mx-[2px] size-3.5 shrink-0 opacity-50" />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      navigateToBreadcrumb(index)
                    }}
                    className=" dark:hover:bg-primary-300">
                    {item.icon && <span className="mr-1">{item.icon}</span>}
                    {item.label}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Variable List */}
        <CommandList className="flex-1 overflow-y-auto" style={{ maxHeight }}>
          {getCurrentLevelItems.length === 0 ? (
            <CommandEmpty className="py-8 flex flex-col items-center">
              <Search className="size-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {search ? 'No variables found' : 'No variables at this level'}
              </p>
              {search && (
                <p className="text-xs mt-1 text-muted-foreground">Try adjusting your search</p>
              )}
            </CommandEmpty>
          ) : (
            <CommandGroup>
              {getCurrentLevelItems.map((item) => (
                <VariableCommandItem
                  key={item.id}
                  item={item}
                  onSelect={() => {
                    setSelectedItemId(item.id)

                    const isGroup = 'variables' in item

                    if (isGroup) {
                      navigateInto(item)
                    } else {
                      handleVariableAction(item as UnifiedVariable)
                    }

                    focusCommandRoot()
                  }}
                  onNavigateInto={() => {
                    navigateInto(item)
                  }}
                  onCopy={copyVariable}
                  isSelected={selectedVariables.includes(item.id)}
                  isHighlighted={selectedItemId === item.id}
                  showPath={!!search}
                  labelPath={
                    !('variables' in item) ? buildLabelPath(item as UnifiedVariable) : undefined
                  }
                  isSelectable={
                    'variables' in item ||
                    isTypeAllowed(item as UnifiedVariable) ||
                    (isNavigable(item as UnifiedVariable) &&
                      hasCompatibleChildPath(item as UnifiedVariable, allowedTypes))
                  }
                />
              ))}
            </CommandGroup>
          )}
        </CommandList>

        {/* Keyboard Navigation Hints */}
        <div className="border-t px-3 py-2 text-xs text-muted-foreground bg-neutral-50 dark:bg-neutral-800">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span>Select</span>

                <kbd className="px-1.5 py-0.5 bg-white dark:bg-neutral-700 border rounded text-[10px] font-mono">
                  ↵
                </kbd>
              </span>
              <span className="flex items-center gap-1">
                <span>Go properties</span>
                <kbd className="px-1.5 py-0.5 bg-white dark:bg-neutral-700 border rounded text-[10px] font-mono">
                  →
                </kbd>
              </span>
              <span className="flex items-center gap-1">
                <span>Back</span>

                <kbd className="px-1.5 py-0.5 bg-white dark:bg-neutral-700 border rounded text-[10px] font-mono">
                  ←
                </kbd>
              </span>
            </div>
          </div>
        </div>
      </Command>
    </div>
  )
}

/**
 * Individual Variable/Group Item Component
 */
interface VariableCommandItemProps {
  item: UnifiedVariable | VariableGroup
  onSelect: () => void
  onNavigateInto: () => void
  onCopy: (variable: UnifiedVariable, e: React.MouseEvent) => void
  isSelected: boolean
  isHighlighted: boolean
  showPath: boolean
  labelPath?: string // Human-readable path for search mode (e.g., "Node Name › property")
  isSelectable: boolean
}

const VariableCommandItem: React.FC<VariableCommandItemProps> = ({
  item,
  onSelect,
  onNavigateInto,
  onCopy,
  isSelected,
  isHighlighted,
  showPath,
  labelPath,
  isSelectable,
}) => {
  const isGroup = 'variables' in item
  const isNav =
    isGroup ||
    ('properties' in item && item.properties && Object.keys(item.properties).length > 0) ||
    ('items' in item && item.items)
  const displayType = getVariableDisplayType(item as UnifiedVariable)

  // Debug logging for displayType issues
  if (!isGroup && typeof displayType !== 'string') {
    console.error('❌ Invalid displayType detected:', {
      itemId: item.id,
      itemType: (item as UnifiedVariable).type,
      displayType: displayType,
      displayTypeType: typeof displayType,
      fullItem: item,
    })
  }

  return (
    <CommandItem
      value={item.id}
      onSelect={onSelect}
      className={cn(
        'group flex h-7 items-start gap-3 px-0 py-0',
        isSelectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
      )}>
      {/* Main Content */}
      <div className="flex-1 min-w-0 h-full flex items-center ps-1">
        <div className="flex items-center gap-2">
          {isGroup && (
            <span
              className={cn('rounded-full size-6 flex items-center justify-center shrink-0 border')}
              style={{ color: (item as VariableGroup).color }}>
              {(item as VariableGroup).icon}
            </span>
          )}

          <code
            className={cn(
              'text-xs font-mono text-foreground font-medium truncate',
              !isGroup && 'ms-2'
            )}>
            {isGroup ? (item as VariableGroup).name : (item as UnifiedVariable).label}
          </code>

          {/* Show label path in search mode */}
          {showPath && labelPath && (
            <span className="text-[10px] text-muted-foreground truncate">{labelPath}</span>
          )}

          {!isGroup && (
            <>
              <TooltipExplanation text={(item as UnifiedVariable).description || ''} />
              <Badge variant="purple" size="xs">
                {displayType}
              </Badge>
            </>
          )}

          {isGroup && (
            <Badge variant="pill" size="xs">
              {(item as VariableGroup).variables.length}
            </Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex h-full">
        {!isGroup && (
          <div className="flex p-1 gap-1 items-center opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100">
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-full hover:bg-primary-200"
              onClick={(e) => onCopy(item as UnifiedVariable, e)}>
              <Copy />
            </Button>
          </div>
        )}
        <div className="h-full p-1 ps-0">
          {isNav ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-full rounded-full border border-transparent group-data-[selected=true]:bg-neutral-200 dark:group-data-[selected=true]:bg-white/10 group-data-[selected=true]:border-neutral-300 dark:group-data-[selected=true]:border-neutral-700"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onNavigateInto()
              }}
              onMouseDown={(e) => {
                // Prevent focus from moving to button
                e.preventDefault()
              }}>
              <ChevronRight />
            </Button>
          ) : (
            <div className="size-7"></div>
          )}
        </div>
      </div>
    </CommandItem>
  )
}

export default VariableExplorerEnhanced
