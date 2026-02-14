// apps/web/src/components/workflow/nodes/ui/block-selector/index.tsx

import { Badge } from '@auxx/ui/components/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Plus } from 'lucide-react'
import React, { memo, useMemo, useRef, useState } from 'react'
import { NodeCategory } from '~/components/workflow/types'
import { useRegistryVersion } from '../../hooks'
import { unifiedNodeRegistry } from '../../nodes/unified-registry'
import type { BlockSelectorProps } from '../node-handle/types'

export const BlockSelector = memo(
  ({
    open,
    onOpenChange,
    onSelect,
    asChild = true,
    placement = 'right',
    triggerClassName,
    availableBlocksTypes,
    customTrigger,
    inline = false,
    ...props
  }: BlockSelectorProps) => {
    const [activeTab, setActiveTab] = useState<'nodes' | 'apps'>('nodes')
    const inputRef = useRef<HTMLInputElement>(null)

    // Subscribe to registry updates so app blocks appear when loaded
    const registryVersion = useRegistryVersion()

    const availableNodes = useMemo(() => {
      return availableBlocksTypes
        .map((nodeId) => {
          const definition = unifiedNodeRegistry.getDefinition(nodeId)
          return definition ? { ...definition, nodeId } : null
        })
        .filter(Boolean)
        .sort((a, b) => {
          // Sort by category then by name
          if (a!.category !== b!.category) {
            return a!.category.localeCompare(b!.category)
          }
          return a!.displayName.localeCompare(b!.displayName)
        })
    }, [availableBlocksTypes, registryVersion])

    // Separate nodes by type
    const { coreNodes, appNodes } = useMemo(() => {
      const core: typeof availableNodes = []
      const apps: typeof availableNodes = []

      availableNodes.forEach((node) => {
        if (!node) return
        if (node.category === NodeCategory.INTEGRATION) {
          apps.push(node)
        } else {
          core.push(node)
        }
      })

      return { coreNodes: core, appNodes: apps }
    }, [availableNodes])

    const currentNodes = activeTab === 'nodes' ? coreNodes : appNodes

    const nodesByCategory = useMemo(() => {
      const categories: Record<string, typeof currentNodes> = {}
      currentNodes.forEach((node) => {
        if (!node) return
        if (!categories[node.category]) {
          categories[node.category] = []
        }
        categories[node.category].push(node)
      })
      return categories
    }, [currentNodes])

    const triggerClassNameResolved =
      typeof triggerClassName === 'function' ? triggerClassName(open) : triggerClassName

    const defaultTrigger = (
      <button
        className={cn(
          'absolute size-4 rounded-full bg-blue-500 text-primary-foreground',
          'flex items-center justify-center shadow-md',
          'hover:scale-110 transition-transform',
          triggerClassNameResolved
        )}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onOpenChange(!open)
        }}>
        <Plus className='size-4' />
      </button>
    )

    // Render content (with or without popover based on inline prop)
    const selectorContent = (
      <div className={cn(inline ? 'w-full' : '', inline && 'bg-background')}>
        {/* Tab Headers */}
        <div className='flex border-b bg-background/50 rounded-t-md'>
          <button
            data-state={activeTab === 'nodes' ? 'active' : undefined}
            className={cn(
              'group relative flex-1 px-3 py-1.5 text-sm font-medium transition-colors  rounded-tl-lg focus-within:outline-none',
              'hover:bg-background/10 text-primary-400',
              'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px]',
              'after:bg-blue-500 after:opacity-0 after:transition-opacity',
              'data-[state=active]:after:opacity-100',
              'data-[state=active]:text-blue-600 data-[state=active]:bg-accent-100/50'
            )}
            onClick={() => setActiveTab('nodes')}>
            Nodes
            <Badge
              size='xs'
              className={cn(
                'ml-2 text-xs text-gray-500 border-black/10 min-w-5 justify-center',
                'group-data-[state=active]:text-background group-data-[state=active]:bg-info-100'
              )}>
              {coreNodes.length}
            </Badge>
          </button>
          <button
            data-state={activeTab === 'apps' ? 'active' : undefined}
            className={cn(
              'group relative flex-1 px-3 py-1.5 text-sm font-medium transition-colors rounded-tr-lg focus-within:outline-none',
              'hover:bg-background/10 text-primary-400',
              'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px]',
              'after:bg-blue-500 after:opacity-0 after:transition-opacity',
              'data-[state=active]:after:opacity-100',
              'data-[state=active]:text-blue-600 data-[state=active]:bg-accent-100/50'
            )}
            onClick={() => setActiveTab('apps')}>
            Apps
            <Badge
              size='xs'
              className={cn(
                'ml-2 text-xs text-gray-500 border-black/10 min-w-5 justify-center',
                'group-data-[state=active]:text-background group-data-[state=active]:bg-info-100'
              )}>
              {appNodes.length}
            </Badge>
          </button>
        </div>

        {/* Content */}
        <Command
          className='bg-transparent'
          onKeyDown={(e) => {
            // Prevent event bubbling that might interfere with closing
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
            }
          }}>
          <CommandInput ref={inputRef} placeholder={`Search ${activeTab}...`} />
          <CommandList className='max-h-[700px]'>
            {activeTab === 'apps' && appNodes.length === 0 ? (
              <div className='p-6 text-center'>
                <div className='text-sm text-gray-500 mb-2'>No apps available</div>
                <div className='text-xs text-gray-400'>
                  Apps will appear here when integrations are installed
                </div>
              </div>
            ) : (
              Object.entries(nodesByCategory).map(([category, nodes]) => (
                <CommandGroup key={category} heading={category.toUpperCase()}>
                  {nodes.map((node) => (
                    <CommandItem
                      key={node!.nodeId}
                      value={node!.nodeId}
                      onSelect={() => {
                        // Pass the type from defaults, not the nodeId
                        onSelect(node!.defaults?.type || node!.nodeId, node!.defaults)
                      }}
                      className={cn(
                        'cursor-pointer data-[selected=true]:bg-primary-300/20 ',
                        activeTab === 'apps' ? 'py-3 px-3' : 'py-1 px-1'
                      )}>
                      {activeTab === 'apps' ? (
                        // Enhanced app display
                        <div className='flex items-center space-x-3 w-full'>
                          <div
                            className='size-8 rounded-md flex items-center justify-center shrink-0'
                            style={{ backgroundColor: node!.color }}>
                            {unifiedNodeRegistry.getNodeIcon(node.id, 'w-5 h-5 text-white')}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='font-medium text-sm'>{node!.displayName}</div>
                            <div className='text-xs text-gray-500 truncate'>
                              {node!.description}
                            </div>
                          </div>
                        </div>
                      ) : (
                        // Standard node display
                        <>
                          <span
                            className={cn(
                              'rounded-full size-6 flex items-center justify-center shrink-0'
                            )}
                            style={{ backgroundColor: node!.color }}>
                            {unifiedNodeRegistry.getNodeIcon(node.id, 'size-4 text-white')}
                          </span>
                          <span className=''>{node!.displayName}</span>
                        </>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </div>
    )

    // Return inline content or wrapped in Popover
    if (inline) {
      return selectorContent
    }

    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild={asChild}>{customTrigger || defaultTrigger}</PopoverTrigger>
        <PopoverContent
          className=' p-0 bg-transparent backdrop-blur-sm'
          align={placement === 'left' ? 'end' : 'start'}
          side={placement}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          {...props}
          style={{ width: activeTab === 'nodes' ? '220px' : '320px' }}>
          {selectorContent}
        </PopoverContent>
      </Popover>
    )
  }
)

BlockSelector.displayName = 'BlockSelector'
