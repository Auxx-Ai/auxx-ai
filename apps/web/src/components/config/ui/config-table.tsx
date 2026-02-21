// apps/web/src/components/config/ui/config-table.tsx
'use client'

import type {
  ConfigVariableGroupData,
  ResolvedConfigVariable,
} from '@auxx/credentials/config/client'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { useConfigStore } from '../store/config-store'
import { ConfigVariableRow } from './config-variable-row'

interface ConfigTableProps {
  groups: ConfigVariableGroupData[]
  isLoading: boolean
  onRowClick: (variable: ResolvedConfigVariable) => void
}

/**
 * Grouped table of config variables.
 * Each group is collapsible. Clicking a row opens the detail drawer.
 */
export function ConfigTable({ groups, isLoading, onRowClick }: ConfigTableProps) {
  const search = useConfigStore((state) => state.search)
  const groupFilter = useConfigStore((state) => state.groupFilter)
  const collapsedGroups = useConfigStore((state) => state.collapsedGroups)
  const toggleGroupCollapsed = useConfigStore((state) => state.toggleGroupCollapsed)

  /** Apply client-side filters */
  const filteredGroups = useMemo(() => {
    return groups
      .filter((g) => !groupFilter || g.group === groupFilter)
      .map((g) => ({
        ...g,
        variables: g.variables.filter((v) => {
          if (search) {
            const q = search.toLowerCase()
            return (
              v.definition.key.toLowerCase().includes(q) ||
              v.definition.description.toLowerCase().includes(q)
            )
          }
          return true
        }),
      }))
      .filter((g) => g.variables.length > 0)
  }, [groups, search, groupFilter])

  if (isLoading) {
    return (
      <div className='space-y-2 p-4'>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className='h-10 w-full' />
        ))}
      </div>
    )
  }

  return (
    <div className='flex-1 overflow-hidden flex flex-col min-h-0 relative'>
      <div className='overflow-auto flex-1 relative'>
        <Table>
          <TableHeader className='sticky top-0 bg-background z-10'>
            <TableRow>
              <TableHead className='w-[280px]'>Variable</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className='w-[120px]'>Source</TableHead>
              <TableHead className='w-[100px]'>Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className='text-center text-muted-foreground py-8'>
                  {search || groupFilter ? 'No variables match your filters' : 'No variables'}
                </TableCell>
              </TableRow>
            ) : (
              filteredGroups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.group)
                return (
                  <Fragment key={group.group}>
                    {/* Group header row */}
                    <TableRow
                      className='bg-muted/50 cursor-pointer hover:bg-muted'
                      onClick={() => toggleGroupCollapsed(group.group)}>
                      <TableCell colSpan={4} className='font-medium'>
                        <div className='flex items-center gap-2'>
                          {isCollapsed ? (
                            <ChevronRight className='size-4' />
                          ) : (
                            <ChevronDown className='size-4' />
                          )}
                          <EntityIcon
                            iconId={group.iconId || 'settings'}
                            color='gray'
                            className='size-6'
                          />
                          {group.label}
                          <span className='text-muted-foreground text-sm font-normal'>
                            ({group.variables.length})
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Variable rows */}
                    {!isCollapsed &&
                      group.variables.map((variable) => (
                        <ConfigVariableRow
                          key={variable.definition.key}
                          variable={variable}
                          onClick={() => onRowClick(variable)}
                        />
                      ))}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
