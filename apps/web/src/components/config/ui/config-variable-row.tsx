// apps/web/src/components/config/ui/config-variable-row.tsx
'use client'

import type { ResolvedConfigVariable } from '@auxx/credentials/config/client'
import { TableCell, TableRow } from '@auxx/ui/components/table'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { Check, Copy } from 'lucide-react'
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
  const keyCopy = useCopy({ toastMessage: 'Key copied to clipboard' })
  const valueCopy = useCopy({ toastMessage: 'Value copied to clipboard' })

  /** Whether the value can be copied (not null and not sensitive) */
  const canCopyValue = value !== null && !definition.isSensitive

  return (
    <TableRow className='group cursor-pointer hover:bg-muted/50' onClick={onClick}>
      <TableCell>
        <div className='flex items-center gap-1.5 font-mono text-sm'>
          <span>{definition.key}</span>
          <button
            type='button'
            className='opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground'
            onClick={(e) => {
              e.stopPropagation()
              keyCopy.copy(definition.key)
            }}
            aria-label='Copy key'>
            {keyCopy.copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
          </button>
        </div>
      </TableCell>
      <TableCell>
        <div className='flex items-center gap-1.5 font-mono text-sm'>
          <span className='truncate max-w-[300px]'>
            {value === null ? (
              <span className='text-muted-foreground italic'>not set</span>
            ) : definition.isSensitive ? (
              '••••••••'
            ) : (
              String(value)
            )}
          </span>
          {canCopyValue && (
            <button
              type='button'
              className='shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground'
              onClick={(e) => {
                e.stopPropagation()
                valueCopy.copy(String(value))
              }}
              aria-label='Copy value'>
              {valueCopy.copied ? (
                <Check className='h-3.5 w-3.5' />
              ) : (
                <Copy className='h-3.5 w-3.5' />
              )}
            </button>
          )}
        </div>
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
