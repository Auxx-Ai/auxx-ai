// src/components/editor/variable-picker-popover-deprecated.tsx
// DEPRECATED: This component has been replaced by variable-picker-command-adapter.tsx
// Please use the new adapter component with the unified variable-picker system
'use client'

import { useEffect, useImperativeHandle, useState, useRef } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Variable, Workflow, Database, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Interface for workflow variable reference
 */
export interface WorkflowVariable {
  id: string
  path: string // e.g., "node1.output.email"
  label: string // Human-readable name
  dataType: string // string, number, object, array, boolean, any
  nodeName: string // Source node name for grouping
  nodeId: string // Source node ID
  description?: string
  isRequired?: boolean
  isArray?: boolean
  examples?: string[]
  children?: WorkflowVariable[] // For hierarchical navigation
  hasChildren?: boolean // Whether this variable has nested properties
  category?: 'node' | 'schema' | 'environment' | 'system' // Enhanced categorization
  parent?: WorkflowVariable // Reference to parent variable
}

/**
 * Props for the VariablePickerPopover component
 */
interface VariablePickerPopoverProps {
  variables: WorkflowVariable[]
  command: (variable: WorkflowVariable) => void
  isLoading?: boolean
  expectedTypes?: string[] // Filter by compatible types
}

/**
 * Reference interface for the VariablePickerPopover component
 */
export interface VariablePickerPopoverRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * VariablePickerPopover component for displaying workflow variables in the editor
 * Inspired by the mention popover but specifically for variable selection
 */
type VarPickerRef = VariablePickerPopoverRef
type VarPickerProps = VariablePickerPopoverProps & React.RefAttributes<VarPickerRef>

export const VariablePickerPopover: React.FC<VarPickerProps> = ({
  variables,
  command,
  isLoading = false,
  expectedTypes,
  ref,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [navigationStack, setNavigationStack] = useState<WorkflowVariable[]>([])
  const [currentVariableId, setCurrentVariableId] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Get current level variables based on navigation
  const getCurrentLevelVariables = () => {
    if (searchQuery) {
      // When searching, show all matching variables flattened
      return variables.filter((variable) => {
        const matchesSearch =
          variable.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          variable.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
          variable.nodeName.toLowerCase().includes(searchQuery.toLowerCase())

        const matchesType =
          !expectedTypes ||
          expectedTypes.includes('any') ||
          expectedTypes.includes(variable.dataType) ||
          variable.dataType === 'any'

        return matchesSearch && matchesType
      })
    }

    if (!currentVariableId) {
      // Root level - show top-level variables grouped by node
      return variables.filter((variable) => !variable.parent)
    }

    // Find children of current variable
    const findChildren = (vars: WorkflowVariable[], id: string): WorkflowVariable[] => {
      for (const variable of vars) {
        if (variable.id === id) {
          return variable.children || []
        }
        if (variable.children?.length) {
          const found = findChildren(variable.children, id)
          if (found.length > 0) return found
        }
      }
      return []
    }

    return findChildren(variables, currentVariableId)
  }

  const currentVariables = getCurrentLevelVariables()

  // Group variables by node (only for root level or search)
  const groupedVariables =
    !currentVariableId || searchQuery
      ? currentVariables.reduce(
          (groups, variable) => {
            const nodeKey = variable.nodeName
            if (!groups[nodeKey]) {
              groups[nodeKey] = []
            }
            groups[nodeKey].push(variable)
            return groups
          },
          {} as Record<string, WorkflowVariable[]>
        )
      : { Properties: currentVariables }

  // Navigation functions
  const navigateToVariable = (variable: WorkflowVariable) => {
    if (!variable.children?.length && !variable.hasChildren) return

    // Push current variable to navigation stack
    setNavigationStack((prev) => [...prev, variable])
    setCurrentVariableId(variable.id)
    setSearchQuery('') // Clear search when navigating

    // Scroll back to top when navigating
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }

  const navigateBack = () => {
    // Pop from navigation stack
    setNavigationStack((prev) => {
      const newStack = [...prev]
      newStack.pop()
      const parentVariable = newStack.length > 0 ? newStack[newStack.length - 1] : null
      setCurrentVariableId(parentVariable?.id || null)
      return newStack
    })
  }

  const navigateTo = (index: number) => {
    // Navigate to specific level in breadcrumb
    setNavigationStack((prev) => {
      const newStack = prev.slice(0, index + 1)
      const parentVariable = newStack.length > 0 ? newStack[newStack.length - 1] : null
      setCurrentVariableId(parentVariable?.id || null)
      return newStack
    })
  }

  /**
   * Handle keyboard navigation and selection
   */
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (event.key === 'ArrowUp') {
      setSelectedIndex((selectedIndex + currentVariables.length - 1) % currentVariables.length)
      return true
    }

    if (event.key === 'ArrowDown') {
      setSelectedIndex((selectedIndex + 1) % currentVariables.length)
      return true
    }

    if (event.key === 'Enter') {
      if (currentVariables[selectedIndex]) {
        const selectedVariable = currentVariables[selectedIndex]
        if (selectedVariable.children?.length || selectedVariable.hasChildren) {
          navigateToVariable(selectedVariable)
        } else {
          command(selectedVariable)
        }
      }
      return true
    }

    if (event.key === 'Backspace' && navigationStack.length > 0 && !searchQuery) {
      navigateBack()
      return true
    }

    return false
  }

  /**
   * Reset selected index when variables change
   */
  useEffect(() => {
    setSelectedIndex(0)
  }, [currentVariables])

  /**
   * Expose onKeyDown method to parent via ref
   */
  useImperativeHandle(ref, () => ({ onKeyDown }))

  /**
   * Handle item selection via click
   */
  const selectVariable = (variable: WorkflowVariable) => {
    if (variable.children?.length || variable.hasChildren) {
      navigateToVariable(variable)
    } else {
      command(variable)
    }
  }

  /**
   * Get type badge styling
   */
  const getTypeBadge = (dataType: string, isCompatible = true) => {
    const typeColors: Record<string, string> = {
      string: 'bg-green-100 text-green-800 border-green-200',
      number: 'bg-blue-100 text-blue-800 border-blue-200',
      boolean: 'bg-purple-100 text-purple-800 border-purple-200',
      object: 'bg-orange-100 text-orange-800 border-orange-200',
      array: 'bg-pink-100 text-pink-800 border-pink-200',
      any: 'bg-gray-100 text-gray-800 border-gray-200',
    }

    const baseClass = typeColors[dataType] || typeColors['any']
    const opacityClass = isCompatible ? '' : 'opacity-50'

    return `${baseClass} ${opacityClass}`
  }

  /**
   * Get node icon based on variable source
   */
  const getNodeIcon = (nodeName: string) => {
    if (nodeName.toLowerCase().includes('trigger')) return <Workflow className="w-3 h-3" />
    if (nodeName.toLowerCase().includes('data')) return <Database className="w-3 h-3" />
    return <Variable className="w-3 h-3" />
  }

  return (
    <Command className="shadow-md border backdrop-blur-sm bg-transparent">
      <CommandInput
        placeholder="Search variables..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      {/* Breadcrumb Navigation */}
      {!searchQuery && navigationStack.length > 0 && (
        <div className="flex items-center border-b px-2 py-1 text-sm">
          <Button variant="ghost" size="icon" className="mr-1 h-6 w-6" onClick={navigateBack}>
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="sr-only">Back</span>
          </Button>

          <div className="flex items-center overflow-x-auto">
            <button
              onClick={() => {
                setNavigationStack([])
                setCurrentVariableId(null)
              }}
              className="whitespace-nowrap px-1 hover:underline">
              All Variables
            </button>

            {navigationStack.map((variable, index) => (
              <div key={variable.id} className="flex items-center">
                <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                <button
                  onClick={() => navigateTo(index)}
                  className={cn(
                    'whitespace-nowrap px-1 hover:underline',
                    index === navigationStack.length - 1 ? 'font-semibold' : ''
                  )}>
                  {variable.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <CommandList className="max-h-80" ref={contentRef}>
        {currentVariables.length > 0 ? (
          Object.entries(groupedVariables).map(([nodeName, nodeVariables], groupIndex) => (
            <div key={nodeName}>
              {groupIndex > 0 && <CommandSeparator />}
              <CommandGroup
                heading={
                  <div className="flex items-center gap-2">
                    {getNodeIcon(nodeName)}
                    <span>{nodeName}</span>
                    <Badge variant="secondary" className="text-xs">
                      {nodeVariables.length}
                    </Badge>
                  </div>
                }>
                {nodeVariables.map((variable) => {
                  const globalIndex = currentVariables.findIndex((v) => v.id === variable.id)
                  const isSelected = globalIndex === selectedIndex
                  const isCompatible =
                    !expectedTypes ||
                    expectedTypes.includes('any') ||
                    expectedTypes.includes(variable.dataType) ||
                    variable.dataType === 'any'
                  const hasChildren = variable.children?.length || variable.hasChildren
                  // ${isSelected ? 'bg-info/10' : ''}
                  return (
                    <CommandItem
                      key={variable.id}
                      value={`${variable.nodeName}-${variable.label}-${variable.path}`}
                      className={cn(
                        'cursor-pointer hover:bg-info/10 data-[selected=true]:bg-info/10 data-[selected=true]:text-info',
                        { 'opacity-50': !isCompatible }
                      )}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      onSelect={() => selectVariable(variable)}
                      disabled={!isCompatible}>
                      <div className="flex items-center justify-between w-full">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{variable.label}</span>
                            {variable.isRequired && (
                              <span className="text-xs font-semibold text-red-500">*</span>
                            )}
                            {hasChildren && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {variable.path}
                          </div>
                          {/* {variable.description && (
                            <div className="text-xs text-muted-foreground mt-1 truncate">
                              {variable.description}
                            </div>
                          )} */}
                        </div>
                        <div className="ml-2 flex-shrink-0 flex items-center gap-1">
                          <Badge
                            variant="pill"
                            size="xs"
                            className={`${getTypeBadge(variable.dataType, isCompatible)}`}>
                            {variable.isArray ? `${variable.dataType}[]` : variable.dataType}
                          </Badge>
                          {hasChildren && !searchQuery && (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </div>
          ))
        ) : isLoading ? (
          <CommandEmpty>Loading variables...</CommandEmpty>
        ) : searchQuery ? (
          <CommandEmpty>No variables found matching "{searchQuery}"</CommandEmpty>
        ) : (
          <CommandEmpty>No variables available from previous nodes</CommandEmpty>
        )}
      </CommandList>
      {expectedTypes && expectedTypes.length > 0 && (
        <div className="border-t p-2 text-xs text-muted-foreground">
          Expected types: {expectedTypes.join(', ')}
        </div>
      )}
    </Command>
  )
}

VariablePickerPopover.displayName = 'VariablePickerPopover'
