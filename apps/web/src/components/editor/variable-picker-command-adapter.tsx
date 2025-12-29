// apps/web/src/components/editor/variable-picker-command-adapter.tsx

'use client'

import React, {
  useImperativeHandle,
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from 'react'
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
import { Variable, Workflow, Database, ChevronRight } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { type AvailableVariable } from '~/components/workflow/hooks/use-available-variables'

/**
 * WorkflowVariable interface to maintain compatibility with TipTap extensions
 */
export interface WorkflowVariable {
  id: string
  // path: string
  label: string
  dataType: string
  // nodeName: string
  // nodeId: string
  description?: string
  isRequired?: boolean
  isArray?: boolean
  examples?: string[]
  // children?: WorkflowVariable[]
  // hasChildren?: boolean
  // category?: 'node' | 'schema' | 'environment' | 'system'
  parent?: WorkflowVariable
}

/**
 * Props for the VariablePickerCommandAdapter component
 */
interface VariablePickerCommandAdapterProps {
  variables: AvailableVariable[]
  command: (variable: WorkflowVariable) => void
  isLoading?: boolean
  expectedTypes?: string[]
}

/**
 * Reference interface for the adapter component
 */
export interface VariablePickerCommandAdapterRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * Convert AvailableVariable to WorkflowVariable format
 */
function convertToWorkflowVariable(av: AvailableVariable): WorkflowVariable {
  return {
    id: av.id,
    // path: av.fullPath,
    label: av.label,
    dataType: av.type,
    // nodeName: av.nodeName || av.source,
    // nodeId: av.nodeId || '',
    description: av.description,
    isRequired: av.required,
    isArray: av.isArray,
    // category: av.category,
    // Flatten hierarchical structure - new variable-picker uses flat structure
    // hasChildren: false,
    // children: undefined,
  }
}

/**
 * Adapter component that provides command palette interface for variable selection
 * Bridges the gap between new variable-picker architecture and TipTap requirements
 */
type AdapterRef = VariablePickerCommandAdapterRef
type AdapterProps = VariablePickerCommandAdapterProps & React.RefAttributes<AdapterRef>

export const VariablePickerCommandAdapter: React.FC<AdapterProps> = ({
  variables,
  command,
  isLoading = false,
  expectedTypes,
  ref,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)

  // Convert variables to enhanced format and then to workflow format
  const workflowVariables = useMemo(() => {
    return variables.map((v, index) => convertToWorkflowVariable(v))
  }, [variables])

  // Filter variables based on search
  const filteredVariables = useMemo(() => {
    if (!searchQuery) return workflowVariables

    return workflowVariables.filter((variable) => {
      const matchesSearch =
        variable.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        variable.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        // variable.nodeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (variable.description &&
          variable.description.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesType =
        !expectedTypes ||
        expectedTypes.includes('any') ||
        expectedTypes.includes(variable.dataType) ||
        variable.dataType === 'any'

      return matchesSearch && matchesType
    })
  }, [workflowVariables, searchQuery, expectedTypes])

  // Group variables by node
  const groupedVariables = useMemo(() => {
    return filteredVariables.reduce(
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
  }, [filteredVariables])

  /**
   * Handle keyboard navigation
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const totalVariables = filteredVariables.length

      if (event.key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev - 1 + totalVariables) % totalVariables)
        return true
      }

      if (event.key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % totalVariables)
        return true
      }

      if (event.key === 'Enter') {
        const selectedVariable = filteredVariables[selectedIndex]
        if (selectedVariable) {
          command(selectedVariable)
        }
        return true
      }

      return false
    },
    [filteredVariables, selectedIndex, command]
  )

  // Reset selected index when filtered variables change
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredVariables])

  // Expose onKeyDown method to parent
  useImperativeHandle(ref, () => ({ onKeyDown }))

  // Get type badge styling
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

  // Get node icon
  const getNodeIcon = (nodeName: string) => {
    if (nodeName.toLowerCase().includes('trigger') || nodeName.toLowerCase().includes('start'))
      return <Workflow className="w-3 h-3" />
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

      <CommandList className="max-h-80" ref={contentRef}>
        {filteredVariables.length > 0 ? (
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
                  const globalIndex = filteredVariables.findIndex((v) => v.id === variable.id)
                  const isSelected = globalIndex === selectedIndex
                  const isCompatible =
                    !expectedTypes ||
                    expectedTypes.includes('any') ||
                    expectedTypes.includes(variable.dataType) ||
                    variable.dataType === 'any'

                  return (
                    <CommandItem
                      key={variable.id}
                      value={`${variable.nodeName}-${variable.label}-${variable.path}`}
                      className={cn(
                        'cursor-pointer hover:bg-info/10 data-[selected=true]:bg-info/10 data-[selected=true]:text-info',
                        { 'opacity-50': !isCompatible }
                      )}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      onSelect={() => command(variable)}
                      disabled={!isCompatible}>
                      <div className="flex items-center justify-between w-full">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{variable.label}</span>
                            {variable.isRequired && (
                              <span className="text-xs font-semibold text-red-500">*</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {variable.path}
                          </div>
                          {variable.description && (
                            <div className="text-xs text-muted-foreground mt-1 truncate">
                              {variable.description}
                            </div>
                          )}
                        </div>
                        <div className="ml-2 flex-shrink-0 flex items-center gap-1">
                          <Badge
                            variant="pill"
                            size="xs"
                            className={`${getTypeBadge(variable.dataType, isCompatible)}`}>
                            {variable.isArray ? `${variable.dataType}[]` : variable.dataType}
                          </Badge>
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

VariablePickerCommandAdapter.displayName = 'VariablePickerCommandAdapter'
