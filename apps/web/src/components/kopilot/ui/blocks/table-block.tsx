// apps/web/src/components/kopilot/ui/blocks/table-block.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { TableBlockData, TableCellData } from './block-schemas'

function CellContent({ cell }: { cell: TableCellData }) {
  if (cell.recordId) {
    return <RecordBadge recordId={cell.recordId as RecordId} variant='link' link />
  }

  if (cell.href) {
    return (
      <a
        href={cell.href}
        target='_blank'
        rel='noopener noreferrer'
        className='text-primary hover:underline'
        onClick={(e) => e.stopPropagation()}>
        {cell.text}
      </a>
    )
  }

  return <>{cell.text}</>
}

export function TableBlock({ data }: BlockRendererProps<TableBlockData>) {
  const { columns, rows } = data

  return (
    <div className='not-prose my-2'>
      <BlockCard hasHeader={false} hasFooter={false}>
        <ScrollArea orientation='horizontal' className='overflow-hidden'>
          <table className='w-full border-collapse text-sm'>
            <thead>
              <tr>
                {columns.map((col, i) => (
                  <th
                    key={i}
                    className='text-muted-foreground border-b bg-muted/50 px-3 py-2 font-medium'
                    style={{ textAlign: col.align ?? 'left' }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className='hover:bg-muted/30 transition-colors'>
                  {row.map((cell, colIdx) => (
                    <td
                      key={colIdx}
                      className={`px-3 py-2 align-top ${rowIdx < rows.length - 1 ? 'border-b' : ''}`}
                      style={{ textAlign: columns[colIdx]?.align ?? 'left' }}>
                      <CellContent cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </BlockCard>
    </div>
  )
}
