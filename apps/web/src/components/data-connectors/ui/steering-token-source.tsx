// apps/web/src/components/data-connectors/ui/steering-token-source.tsx
'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { Hash } from 'lucide-react'
import type { TokenSource } from '~/components/global/token-field'
import { recordBadgeVariants } from '~/components/resources/ui'
import { lastSegment } from '../hooks/use-source-paths'

/**
 * A {@link TokenSource} over a stream's declared webhook-steering `{path}`
 * placeholders (`requestConfig.webhookTrigger.paths`). The picker offers only the
 * declared paths — the source of truth is the Webhook steering section's
 * checklist, so a path shows up here once it's declared there. A token typed by
 * hand that isn't declared renders as an "unknown" chip (it won't resolve at
 * fetch time) so the gap is visible.
 */
export function makeSteeringTokenSource(paths: string[]): TokenSource {
  const declared = new Set(paths)
  return {
    renderBadge: (id, selected) => (
      <SteeringPathBadge path={id} selected={selected} known={declared.has(id)} />
    ),
    renderPickerItems: ({ onSelect, onClose }) => (
      <Command>
        <CommandInput placeholder='Search payload fields…' />
        <CommandList>
          <CommandEmpty>
            {paths.length === 0
              ? 'Declare payload fields in Webhook steering first.'
              : 'No matching fields.'}
          </CommandEmpty>
          {paths.length > 0 && (
            <CommandGroup heading='Payload fields'>
              {paths.map((path) => (
                <CommandItem
                  key={path}
                  value={path}
                  onSelect={() => {
                    onSelect(path)
                    onClose()
                  }}>
                  <Hash className='size-3.5 text-muted-foreground' />
                  <span className='font-mono text-sm'>{path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    ),
  }
}

/** Inline chip for a steering `{path}` token; flags an undeclared (unknown) path. */
function SteeringPathBadge({
  path,
  selected,
  known,
}: {
  path: string
  selected?: boolean
  known: boolean
}) {
  return (
    <span
      data-slot='field-badge'
      title={known ? path : `${path} — not a declared payload field`}
      className={cn(
        recordBadgeVariants({}),
        'font-mono font-normal',
        selected && 'ring-2 ring-primary ring-offset-1',
        !known && 'text-destructive ring-1 ring-destructive/40'
      )}>
      <Hash className={cn('size-3', known ? 'text-muted-foreground' : 'text-destructive')} />
      <span className='truncate'>{lastSegment(path)}</span>
    </span>
  )
}
