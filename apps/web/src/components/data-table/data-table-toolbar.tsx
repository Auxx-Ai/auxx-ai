'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import type { Table } from '@tanstack/react-table'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { priorities, statuses } from '~/constants/products'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { DataTableFacetedFilter } from './data-table-faceted-filter'
import { DataTableViewOptions } from './data-table-view-options'

// import { priorities, statuses } from '../data/data'
// import { DataTableFacetedFilter } from './data-table-faceted-filter'

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  label: string
}

export function DataTableToolbar<TData>({ table, label }: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0

  const searchInputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState((table.getColumn('title')?.getFilterValue() as string) ?? '')
  const [debouncedSearch] = useDebouncedValue(search, 300)

  useEffect(() => {
    console.log('use effect', debouncedSearch)
    table.getColumn('title')?.setFilterValue(debouncedSearch)
  }, [debouncedSearch])
  // useDebouncedValue()

  return (
    <div className='flex items-center justify-between p-2 bg-primary-50 border-b'>
      <div className='flex flex-1 items-center space-x-2'>
        <Input
          placeholder={`Filter ${label}...`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          // onChange={(event) =>
          // table.getColumn('title')?.setFilterValue(event.target.value)
          // }
          className='h-8 w-[150px] lg:w-[250px]'
        />
        {table.getAllColumns().find((x) => x.id === 'status') && (
          <DataTableFacetedFilter
            column={table.getColumn('status')}
            title='Status'
            options={statuses}
          />
        )}
        {table.getAllColumns().find((x) => x.id === 'priority') && (
          <DataTableFacetedFilter
            column={table.getColumn('priority')}
            title='Priority'
            options={priorities}
          />
        )}
        {isFiltered && (
          <Button
            variant='ghost'
            onClick={() => table.resetColumnFilters()}
            className='h-8 px-2 lg:px-3'>
            Reset
            <X />
          </Button>
        )}
      </div>
      <DataTableViewOptions table={table} />
    </div>
  )
}
