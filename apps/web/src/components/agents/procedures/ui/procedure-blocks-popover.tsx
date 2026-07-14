// apps/web/src/components/agents/procedures/ui/procedure-blocks-popover.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandDetailItem,
  CommandGroup,
  CommandGroupLabel,
  CommandList,
  CommandPlaceholder,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Blocks, Code2, Plus, Trash2, Workflow } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { type BuildingBlockKind, useDeleteBuildingBlock } from '../hooks/use-delete-building-block'
import { useProcedureDraft } from './procedure-draft-provider'
import { countReferences } from './reference-usage'

/**
 * The "Building blocks" Section action — a popover listing every sub-procedure and
 * code block that belongs to the open procedure, each in its own labelled group,
 * plus a create group. Selecting any row (existing or create) drills into that body
 * on the outer NavStack via `openDrill('sub:<id>' | 'code:<id>')`.
 */
export function ProcedureBlocksPopover() {
  const draft = useProcedureDraft()
  const [open, setOpen] = useState(false)
  const { requestDelete, ConfirmDialog } = useDeleteBuildingBlock()
  if (!draft) return null

  const { subProcedures, codeBlocks, createSubProcedure, createCodeBlock, openDrill } = draft

  // Live reference universe for the counters — main prose + every sub-procedure body.
  const mainContent = draft.getMainContent()
  const subsWithContent = subProcedures.map((s) => ({
    id: s.id,
    name: s.name,
    content: draft.getSubContent(s.id),
  }))
  const refCount = (kind: BuildingBlockKind, id: string) =>
    countReferences(kind === 'code' ? `code:${id}` : `subprocedure:${id}`, {
      mainContent,
      subProcedures: subsWithContent,
      excludeSubId: kind === 'sub' ? id : undefined,
    }).count

  // Close the popover, then navigate to the drilled body.
  const go = (key: string) => {
    openDrill(key)
    setOpen(false)
  }

  // Delete without selecting the row — close the popover first so its outside-focus
  // close doesn't fight the confirm dialog (which is rendered outside the popover).
  const remove = (kind: BuildingBlockKind, id: string, name: string) => {
    setOpen(false)
    void requestDelete(kind, id, name)
  }

  const isEmpty = subProcedures.length === 0 && codeBlocks.length === 0

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant='ghost' size='xs'>
            <Blocks />
            Building blocks
          </Button>
        </PopoverTrigger>
        <PopoverContent align='end' className='w-72 p-0'>
          <Command shouldFilter={false} className='rounded-2xl'>
            <CommandList>
              {isEmpty && <CommandPlaceholder>No building blocks yet</CommandPlaceholder>}

              {subProcedures.length > 0 && (
                <CommandGroup aria-label='Sub-procedures'>
                  <CommandGroupLabel>Sub-procedures</CommandGroupLabel>
                  {subProcedures.map((s) => (
                    <BlockRow
                      key={s.id}
                      icon={<Workflow className='size-4' />}
                      label={s.name}
                      value={`sub:${s.id}`}
                      count={refCount('sub', s.id)}
                      onSelect={() => go(`sub:${s.id}`)}
                      onDelete={() => remove('sub', s.id, s.name)}
                    />
                  ))}
                </CommandGroup>
              )}

              {codeBlocks.length > 0 && (
                <CommandGroup aria-label='Code blocks'>
                  <CommandGroupLabel>Code blocks</CommandGroupLabel>
                  {codeBlocks.map((c) => (
                    <BlockRow
                      key={c.id}
                      icon={<Code2 className='size-4' />}
                      label={c.name}
                      value={`code:${c.id}`}
                      count={refCount('code', c.id)}
                      onSelect={() => go(`code:${c.id}`)}
                      onDelete={() => remove('code', c.id, c.name)}
                    />
                  ))}
                </CommandGroup>
              )}

              <CommandSeparator />

              <CommandGroup aria-label='Create'>
                <CommandDetailItem
                  icon={<Plus className='size-4' />}
                  title='Create sub-procedure'
                  value='__create-subprocedure'
                  onSelect={() => go(`sub:${createSubProcedure('')}`)}
                />
                <CommandDetailItem
                  icon={<Plus className='size-4' />}
                  title='Create code block'
                  value='__create-code'
                  onSelect={() => go(`code:${createCodeBlock('')}`)}
                />
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* Outside the Popover so it survives the popover closing on delete. */}
      <ConfirmDialog />
    </>
  )
}

/**
 * A building-block row: icon + name (selecting drills in) with a trailing trash button
 * revealed on hover/focus. The trash swallows the click so it deletes instead of drilling.
 */
function BlockRow({
  icon,
  label,
  value,
  count,
  onSelect,
  onDelete,
}: {
  icon: ReactNode
  label: string
  value: string
  count: number
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <CommandDetailItem
      value={value}
      onSelect={onSelect}
      icon={icon}
      title={label}
      trailing={
        <span
          className='text-xs tabular-nums text-muted-foreground'
          title={`${count} ${count === 1 ? 'reference' : 'references'}`}>
          {count} {count === 1 ? 'ref' : 'refs'}
        </span>
      }
      actions={
        <button
          type='button'
          aria-label={`Delete ${label}`}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}
          className='inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-bad-100 hover:text-bad-500'>
          <Trash2 className='size-3.5' />
        </button>
      }
    />
  )
}
