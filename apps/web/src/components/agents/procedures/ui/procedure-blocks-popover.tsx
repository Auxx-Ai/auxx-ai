// apps/web/src/components/agents/procedures/ui/procedure-blocks-popover.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandIconItem,
  CommandList,
  CommandPlaceholder,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Blocks, Code2, Plus, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useProcedureDraft } from './procedure-draft-provider'

/**
 * The "Building blocks" Section action — a popover listing every sub-procedure and
 * code block that belongs to the open procedure, each in its own labelled group,
 * plus a create group. Selecting any row (existing or create) drills into that body
 * on the outer NavStack via `openDrill('sub:<id>' | 'code:<id>')`.
 */
export function ProcedureBlocksPopover() {
  const draft = useProcedureDraft()
  const [open, setOpen] = useState(false)
  if (!draft) return null

  const { subProcedures, codeBlocks, createSubProcedure, createCodeBlock, openDrill } = draft

  // Close the popover, then navigate to the drilled body.
  const go = (key: string) => {
    openDrill(key)
    setOpen(false)
  }

  const isEmpty = subProcedures.length === 0 && codeBlocks.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='xs'>
          <Blocks />
          Building blocks
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-72 p-0'>
        <Command shouldFilter={false} className='rounded-lg'>
          <CommandList>
            {isEmpty && <CommandPlaceholder>No building blocks yet</CommandPlaceholder>}

            {subProcedures.length > 0 && (
              <CommandGroup aria-label='Sub-procedures'>
                <CommandGroupLabel>Sub-procedures</CommandGroupLabel>
                {subProcedures.map((s) => (
                  <CommandIconItem
                    key={s.id}
                    icon={<Workflow className='size-4' />}
                    label={s.name}
                    value={`sub:${s.id}`}
                    onSelect={() => go(`sub:${s.id}`)}
                  />
                ))}
              </CommandGroup>
            )}

            {codeBlocks.length > 0 && (
              <CommandGroup aria-label='Code blocks'>
                <CommandGroupLabel>Code blocks</CommandGroupLabel>
                {codeBlocks.map((c) => (
                  <CommandIconItem
                    key={c.id}
                    icon={<Code2 className='size-4' />}
                    label={c.name}
                    value={`code:${c.id}`}
                    onSelect={() => go(`code:${c.id}`)}
                  />
                ))}
              </CommandGroup>
            )}

            <CommandSeparator />

            <CommandGroup aria-label='Create'>
              <CommandIconItem
                icon={<Plus className='size-4' />}
                label='Create sub-procedure'
                value='__create-subprocedure'
                onSelect={() => go(`sub:${createSubProcedure('')}`)}
              />
              <CommandIconItem
                icon={<Plus className='size-4' />}
                label='Create code block'
                value='__create-code'
                onSelect={() => go(`code:${createCodeBlock('')}`)}
              />
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
