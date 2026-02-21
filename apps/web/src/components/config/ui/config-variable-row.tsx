// apps/web/src/components/config/ui/config-variable-row.tsx
'use client'

import type { ResolvedConfigVariable } from '@auxx/credentials/config/client'
import { TableCell, TableRow } from '@auxx/ui/components/table'
import { SourceBadge, TypeBadge } from './source-badge'

interface ConfigVariableRowProps {
  variable: ResolvedConfigVariable
  onClick: () => void
}

/**
 * A single config variable row in the grouped table.
 */
export function ConfigVariableRow({ variable, onClick }: ConfigVariableRowProps) {
  const { definition, value, source } = variable

  return (
    <TableRow className='cursor-pointer hover:bg-muted/50' onClick={onClick}>
      <TableCell>
        <div className='font-mono text-sm'>{definition.key}</div>
      </TableCell>
      <TableCell>
        <span className='font-mono text-sm truncate max-w-[300px] block'>
          {definition.isSensitive ? (
            '••••••••'
          ) : value !== null ? (
            String(value)
          ) : (
            <span className='text-muted-foreground italic'>not set</span>
          )}
        </span>
      </TableCell>
      <TableCell>
        <SourceBadge source={source} />
      </TableCell>
      <TableCell>
        <TypeBadge type={definition.type} />
      </TableCell>
    </TableRow>
  )
}
