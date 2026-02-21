// apps/web/src/components/health/ui/database-details.tsx
'use client'

import { Separator } from '@auxx/ui/components/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { ProgressBar } from './progress-bar'
import { StatRow } from './stat-row'

interface DatabaseDetailsProps {
  details: Record<string, any>
}

/**
 * Database indicator detail view.
 */
export function DatabaseDetails({ details }: DatabaseDetailsProps) {
  const { system, connections, databaseSize, performance, top10Tables } = details

  return (
    <div className='space-y-6'>
      <div>
        <h4 className='text-sm font-medium mb-2'>System</h4>
        <StatRow label='Version' value={system?.version ?? 'Unknown'} />
        <StatRow label='Uptime' value={system?.uptime ?? 'Unknown'} />
      </div>

      <Separator />

      <div>
        <h4 className='text-sm font-medium mb-2'>Connections</h4>
        <ProgressBar
          value={connections?.active ?? 0}
          max={connections?.max ?? 100}
          label='Active'
        />
      </div>

      <Separator />

      <div>
        <h4 className='text-sm font-medium mb-2'>Performance</h4>
        <StatRow label='Cache Hit Ratio' value={performance?.cacheHitRatio ?? '0%'} />
        <StatRow label='Deadlocks' value={performance?.deadlocks ?? 0} />
        <StatRow label='Slow Queries' value={performance?.slowQueries ?? 0} />
      </div>

      <Separator />

      <StatRow label='Database Size' value={databaseSize ?? 'Unknown'} />

      <Separator />

      {top10Tables && top10Tables.length > 0 && (
        <div>
          <h4 className='text-sm font-medium mb-2'>Top Tables</h4>
          <div className='overflow-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className='text-right'>Live Rows</TableHead>
                  <TableHead className='text-right'>Dead Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top10Tables.map((table: any) => (
                  <TableRow key={`${table.schemaname}.${table.relname}`}>
                    <TableCell className='font-mono text-xs'>{table.relname}</TableCell>
                    <TableCell className='text-right'>
                      {Number(table.n_live_tup).toLocaleString()}
                    </TableCell>
                    <TableCell className='text-right'>
                      {Number(table.n_dead_tup).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
