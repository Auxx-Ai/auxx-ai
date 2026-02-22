// apps/web/src/components/health/ui/database-details.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
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
    <>
      <Section title='System' description='Database engine version and uptime' initialOpen>
        <StatRow label='Version' value={system?.version ?? 'Unknown'} />
        <StatRow label='Uptime' value={system?.uptime ?? 'Unknown'} />
      </Section>

      <Section title='Connections' description='Active vs max connection pool usage' initialOpen>
        <ProgressBar
          value={connections?.active ?? 0}
          max={connections?.max ?? 100}
          label='Active'
        />
      </Section>

      <Section
        title='Performance'
        description='Cache efficiency, deadlocks, and slow queries'
        initialOpen>
        <StatRow label='Cache Hit Ratio' value={performance?.cacheHitRatio ?? '0%'} />
        <StatRow label='Deadlocks' value={performance?.deadlocks ?? 0} />
        <StatRow label='Slow Queries' value={performance?.slowQueries ?? 0} />
      </Section>

      <Section title='Storage' description='Total database disk usage' initialOpen>
        <StatRow label='Database Size' value={databaseSize ?? 'Unknown'} />
      </Section>

      {top10Tables && top10Tables.length > 0 && (
        <Section title='Top Tables' description='Largest tables by row count' initialOpen>
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
        </Section>
      )}
    </>
  )
}
