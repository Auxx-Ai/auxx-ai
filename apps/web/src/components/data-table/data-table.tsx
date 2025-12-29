'use client'

// import * as React from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  // getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  ColumnResizeMode,
  getExpandedRowModel,
} from '@tanstack/react-table'

// import { DataTablePagination } from './data-table-pagination'
import { DataTableToolbar } from './data-table-toolbar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { createContext, Fragment, useEffect, useReducer, useRef, useState } from 'react'
import InfiniteScroll from '@auxx/ui/components/infinite-scroll'
import { InfoIcon, Loader2 } from 'lucide-react'
// import useCustomers from '~/hooks/use-customers'

type TableContext = import('@tanstack/table-core').Table<TData> | null
export const DataTableConext = createContext<TableContext>(null)

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  label: string
  id: string
  toolbar?: React.ReactNode
  children?: React.ReactNode
  fetchNextPage: () => void
  isFetching: boolean
  hasNextPage?: boolean
}

export function DataTable<TData, TValue>({
  columns,
  data,
  label,
  id,
  toolbar,
  children,
  fetchNextPage,
  isFetching,
  hasNextPage,
}: DataTableProps<TData, TValue>) {
  // Setup table
  // const { customers, isFetching, fetchNextPage, hasNextPage } = useCustomers()

  const tableContainerRef = useRef<HTMLDivElement>(null)
  // const tableContainerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)

  // Track column resize state
  const [columnResizing, setColumnResizing] = useState(false)
  const [columnSizingInfo, setColumnSizingInfo] = useState({})

  // init rowSelection
  const [rowSelection, setRowSelection] = useState({})

  // init column visibility
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    if (typeof window !== 'undefined') {
      const savedVisibility = localStorage?.getItem(`table-visibility-${id}`)
      return savedVisibility ? JSON.parse(savedVisibility) : {}
    }
  })
  /*
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => {
      const savedVisibility = localStorage.getItem(`table-visibility-${id}`)
      return savedVisibility ? JSON.parse(savedVisibility) : {}
    }
  )*/

  const [columnResizeMode] = useState<ColumnResizeMode>('onChange') // onEnd, onChange

  // const [columnResizeDirection, setColumnResizeDirection] = useState<ColumnResizeDirection>('ltr')

  const rerender = useReducer(() => ({}), {})[1]

  useEffect(() => {
    // Check if window is defined (i.e., code is running in the browser)
    if (typeof window !== 'undefined') {
      const savedVisibility = localStorage?.getItem(`table-visibility-${id}`)
      if (savedVisibility) {
        setColumnVisibility(JSON.parse(savedVisibility))
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(`table-visibility-${id}`, JSON.stringify(columnVisibility))
  }, [columnVisibility])

  // const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    if (typeof window !== 'undefined') {
      const savedFilters = localStorage?.getItem(`table-filters-${id}`)
      return savedFilters ? JSON.parse(savedFilters) : []
    } else return []
  })

  useEffect(() => {
    localStorage.setItem('table-filters', JSON.stringify(columnFilters))
  }, [columnFilters])

  // const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  useEffect(() => {
    // Check if window is defined (i.e., code is running in the browser)
    if (typeof window !== 'undefined') {
      const savedFilters = localStorage.getItem(`table-filters-${id}`)
      if (savedFilters) {
        setColumnFilters(JSON.parse(savedFilters))
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`table-filters-${id}`, JSON.stringify(columnFilters))
    }
  }, [columnFilters])

  const [sorting, setSorting] = useState<SortingState>([])

  const totalDBRowCount = 1000 //data?.pages?.[0]?.meta?.totalRowCount ?? 0
  const totalFetched = data.length

  //called on scroll and possibly on mount to fetch more data as the user scrolls and reaches bottom of table
  /*const fetchMoreOnBottomReached = useCallback(
    (containerRefElement?: HTMLDivElement | null) => {
      if (containerRefElement) {
        const { scrollHeight, scrollTop, clientHeight } = containerRefElement
        //once the user has scrolled within 500px of the bottom of the table, fetch more data if we can
        if (
          scrollHeight - scrollTop - clientHeight < 500 &&
          !isFetching &&
          totalFetched < totalDBRowCount
        ) {
          fetchNextPage()
        }
      }
    },
    [fetchNextPage, isFetching, totalFetched, totalDBRowCount]
  )*/

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      columnSizing: columnSizingInfo,
    },
    enableRowSelection: true,
    // getRowCanExpand: (row) => Boolean(row.original.note),
    getRowCanExpand: (row) => true,
    getExpandedRowModel: getExpandedRowModel(),
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onColumnSizingChange: setColumnSizingInfo,
    onColumnSizingInfoChange: (updater) => {
      const info = typeof updater === 'function' ? updater(columnSizingInfo) : updater
      setColumnResizing(!!info.isResizingColumn)
      setColumnSizingInfo(info)
    },
  })

  const { rows } = table.getRowModel()
  /*
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 33, //estimate row height for accurate scrollbar dragging
    getScrollElement: () => tableContainerRef.current,
    //measure dynamic row height, except in firefox because it measures table border height incorrectly
    measureElement:
      typeof window !== 'undefined' &&
      navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 5,
  })
*/

  // Measure container width on mount and window resize
  useEffect(() => {
    const updateWidth = () => {
      if (tableContainerRef.current) {
        setContainerWidth(tableContainerRef.current.offsetWidth)
      }
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Calculate and adjust column widths to fill container
  useEffect(() => {
    if (containerWidth > 0 && !columnResizing) {
      const totalColumnWidth = table.getTotalSize()
      const diff = containerWidth - totalColumnWidth

      // Only proceed if there's a significant difference to adjust
      if (Math.abs(diff) > 5) {
        const columnSizingCopy = { ...columnSizingInfo }
        const headers = table.getHeaderGroups()[0].headers

        // Find columns that can still grow
        const growableColumns = headers.filter((header) => {
          const columnId = header.id
          const column = table.getColumn(columnId)
          const currentSize = columnSizingCopy[columnId] || column.getSize()
          const maxSize = column.columnDef.maxSize || Number.MAX_SAFE_INTEGER

          return diff > 0 && currentSize < maxSize
        })

        // Find columns that can shrink if needed
        const shrinkableColumns = headers.filter((header) => {
          const columnId = header.id
          const column = table.getColumn(columnId)
          const currentSize = columnSizingCopy[columnId] || column.getSize()
          const minSize = column.columnDef.minSize || 0

          return diff < 0 && currentSize > minSize
        })

        const columnsToAdjust = diff > 0 ? growableColumns : shrinkableColumns

        if (columnsToAdjust.length > 0) {
          // Calculate how much each column can still grow/shrink
          const columnGrowthPotential = columnsToAdjust.map((header) => {
            const columnId = header.id
            const column = table.getColumn(columnId)
            const currentSize = columnSizingCopy[columnId] || column.getSize()

            if (diff > 0) {
              const maxSize = column.columnDef.maxSize || Number.MAX_SAFE_INTEGER
              return { id: columnId, potential: maxSize - currentSize }
            } else {
              const minSize = column.columnDef.minSize || 0
              return { id: columnId, potential: currentSize - minSize }
            }
          })

          // Calculate total potential growth/shrinkage
          const totalPotential = columnGrowthPotential.reduce((sum, col) => sum + col.potential, 0)

          // Distribute the difference proportionally based on growth potential
          if (totalPotential > 0) {
            columnGrowthPotential.forEach((col) => {
              const columnId = col.id
              const column = table.getColumn(columnId)
              const currentSize = columnSizingCopy[columnId] || column.getSize()

              // Calculate proportional adjustment
              const proportion = col.potential / totalPotential
              const adjustment = Math.floor(diff * proportion)

              // Apply the adjustment
              columnSizingCopy[columnId] = currentSize + adjustment
            })

            setColumnSizingInfo(columnSizingCopy)
          }
        }
      }
    }
  }, [containerWidth, columnResizing, table])
  return (
    <DataTableConext.Provider value={table}>
      <div className="flex flex-1 flex-col w-full h-full">
        {children}
        <DataTableToolbar table={table} label={label} />
        <div
          className="relative flex-1 overflow-y-auto"
          // onScroll={(e) => fetchMoreOnBottomReached(e.currentTarget)}
          ref={tableContainerRef}>
          <table style={{ width: table.getCenterTotalSize(), display: 'grid' }}>
            <TableHeader style={{ display: 'grid', position: 'sticky', top: 0, zIndex: 1 }}>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} style={{ display: 'flex' }}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
                        style={{
                          width: header.getSize(),
                          display: 'flex',
                          alignItems: 'center',
                          position: 'relative',
                        }}
                        className={'bg-background'}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        <div
                          {...{
                            onDoubleClick: () => header.column.resetSize(),
                            onMouseDown: header.getResizeHandler(),
                            onTouchStart: header.getResizeHandler(),
                            className: `resizer ${table.options.columnResizeDirection} ${
                              header.column.getIsResizing() ? 'isResizing' : ''
                            }`,
                            style: {
                              transform:
                                columnResizeMode === 'onEnd' && header.column.getIsResizing()
                                  ? `translateX(${
                                      (table.options.columnResizeDirection === 'rtl' ? -1 : 1) *
                                      (table.getState().columnSizingInfo.deltaOffset ?? 0)
                                    }px)`
                                  : '',
                            },
                          }}
                        />
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody style={{ display: 'grid', position: 'relative' }}>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && 'selected'}
                      style={{ position: 'relative', display: 'flex' }}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          style={{
                            width: cell.column.getSize(),
                            display: 'flex',
                            alignItems: 'center',
                          }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {row.getIsExpanded() && (
                      <TableRow>
                        <TableCell colSpan={row.getVisibleCells().length}>
                          <div className="flex items-start py-2 text-foreground/80">
                            <span
                              className="me-3 mt-0.5 flex w-7 shrink-0 justify-center"
                              aria-hidden="true">
                              <InfoIcon className="opacity-60" size={16} />
                            </span>
                            <p className="text-sm">Lallalala</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </table>
          <InfiniteScroll
            isLoading={isFetching}
            hasMore={hasNextPage!}
            next={() => {
              // console.log('fetching more data')
              fetchNextPage()
            }}>
            {hasNextPage && <Loader2 className="mx-auto my-4 h-8 w-8 animate-spin" />}
          </InfiniteScroll>

          {/* <DataTablePagination table={table} /> */}
        </div>
      </div>
    </DataTableConext.Provider>
  )
}
