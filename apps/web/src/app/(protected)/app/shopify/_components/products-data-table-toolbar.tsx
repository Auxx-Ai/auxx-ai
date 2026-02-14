'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Table } from '@tanstack/react-table'
import { X } from 'lucide-react'
import { useContext } from 'react'
import { DataTableConext } from '~/components/data-table/data-table'
import { DataTableFacetedFilter } from '~/components/data-table/data-table-faceted-filter'
import { DataTableViewOptions } from '~/components/data-table/data-table-view-options'
// import { DataTableViewOptions } from './data-table-view-options'
// import { DataTableFacetedFilter } from './data-table-faceted-filter'
import { priorities, statuses } from '~/constants/products'

// import { priorities, statuses } from '../data/data'
// import { DataTableFacetedFilter } from './data-table-faceted-filter'

interface DataTableToolbarProps<TData> {
  // table: Table<TData>
  label: string
}

export function DataTableToolbar<TData>({
  // table,
  label,
}: DataTableToolbarProps<TData>) {
  const table = useContext(DataTableConext)

  const isFiltered = table?.getState().columnFilters.length > 0

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-1 items-center space-x-2'>
        <Input
          placeholder={`Filter ${label}...`}
          value={(table.getColumn('title')?.getFilterValue() as string) ?? ''}
          onChange={(event) => table.getColumn('title')?.setFilterValue(event.target.value)}
          className='h-8 w-[150px] lg:w-[250px]'
        />
        {table.getColumn('status') && (
          <DataTableFacetedFilter
            column={table.getColumn('status')}
            title='Status'
            options={statuses}
          />
        )}
        {table.getColumn('priority') && (
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
