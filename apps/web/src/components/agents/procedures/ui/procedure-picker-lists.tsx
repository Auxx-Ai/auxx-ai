// apps/web/src/components/agents/procedures/ui/procedure-picker-lists.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandPlaceholder,
} from '@auxx/ui/components/command'
import {
  Calendar,
  CheckSquare,
  Code2,
  CornerDownRight,
  GitBranch,
  Hand,
  Hash,
  Plus,
  Square,
  Type,
  Variable,
  Workflow,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '~/trpc/react'
import { newConditionBlock } from '../nodes/condition-helpers'
import { useProcedureEditorContext } from './procedure-editor-context'

/**
 * The `@`-picker lists for the v9 procedure step tabs (plan §5). Every insertion
 * goes through `@`: these render inside `ReferencePickerContent` for the
 * `routing` / `code` / `subprocedure` / `condition` tabs and act on the
 * {@link useProcedureEditorContext} (create / drill / insert). Terminal picks call
 * `onSelect(id)` → an inline reference badge; `condition` inserts a block node.
 */

interface PickerListProps {
  /** Search query forwarded from the picker chip. */
  query: string
  /** Insert an inline badge with this id (→ `confirmReferencePicker`). */
  onSelect: (id: string) => void
}

function Row({
  icon,
  label,
  value,
  onSelect,
}: {
  icon: ReactNode
  label: string
  value: string
  onSelect: () => void
}) {
  return (
    <CommandItem value={value} onSelect={onSelect} className='flex items-center gap-2'>
      <span className='text-muted-foreground'>{icon}</span>
      <span className='truncate text-sm'>{label}</span>
    </CommandItem>
  )
}

function matches(label: string, query: string) {
  return !query.trim() || label.toLowerCase().includes(query.trim().toLowerCase())
}

/** Routing tab — End / Hand off / Switch to another procedure (terminal badges). */
export function RoutingPickerList({ query, onSelect }: PickerListProps) {
  const list = api.procedure.list.useQuery()
  const switchTargets = (list.data ?? []).filter((p) => matches(`Switch to ${p.name}`, query))

  return (
    <Command shouldFilter={false} className='rounded-lg'>
      <CommandList>
        <CommandGroup aria-label='Routing'>
          {matches('End procedure', query) && (
            <Row
              icon={<Square className='size-4' />}
              label='End procedure'
              value='route:finished'
              onSelect={() => onSelect('route:finished')}
            />
          )}
          {matches('Hand off to human', query) && (
            <Row
              icon={<Hand className='size-4' />}
              label='Hand off to human'
              value='route:handoff'
              onSelect={() => onSelect('route:handoff')}
            />
          )}
          {switchTargets.map((p) => (
            <Row
              key={p.id}
              icon={<CornerDownRight className='size-4' />}
              label={`Switch to ${p.name}`}
              value={`route:switch:${p.id}`}
              onSelect={() => onSelect(`route:switch:${p.id}`)}
            />
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** Sub-procedure tab — pick an existing one, or create from the typed query. */
export function SubProcedurePickerList({ query, onSelect }: PickerListProps) {
  const ctx = useProcedureEditorContext()
  const existing = (ctx?.subProcedures ?? []).filter((s) => matches(s.name, query))

  const create = () => {
    if (!ctx) return
    const id = ctx.createSubProcedure(query)
    onSelect(`subprocedure:${id}`)
    ctx.drillInto(`sub:${id}`)
  }

  return (
    <Command shouldFilter={false} className='rounded-lg'>
      <CommandList>
        <CommandGroup aria-label='Sub-procedures'>
          {existing.map((s) => (
            <Row
              key={s.id}
              icon={<Workflow className='size-4' />}
              label={s.name}
              value={`subprocedure:${s.id}`}
              onSelect={() => onSelect(`subprocedure:${s.id}`)}
            />
          ))}
          <Row
            icon={<Plus className='size-4' />}
            label={query.trim() ? `Create sub-procedure “${query.trim()}”` : 'Create sub-procedure'}
            value='__create-subprocedure'
            onSelect={create}
          />
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** Code tab — pick an existing code block, or create from the typed query. */
export function CodePickerList({ query, onSelect }: PickerListProps) {
  const ctx = useProcedureEditorContext()
  const existing = (ctx?.codeBlocks ?? []).filter((c) => matches(c.name, query))

  const create = () => {
    if (!ctx) return
    const id = ctx.createCodeBlock(query)
    onSelect(`code:${id}`)
    ctx.drillInto(`code:${id}`)
  }

  return (
    <Command shouldFilter={false} className='rounded-lg'>
      <CommandList>
        <CommandGroup aria-label='Code'>
          {existing.map((c) => (
            <Row
              key={c.id}
              icon={<Code2 className='size-4' />}
              label={c.name}
              value={`code:${c.id}`}
              onSelect={() => onSelect(`code:${c.id}`)}
            />
          ))}
          <Row
            icon={<Plus className='size-4' />}
            label={query.trim() ? `Create code block “${query.trim()}”` : 'Create code block'}
            value='__create-code'
            onSelect={create}
          />
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** The curated `dataType` choices the Create-attribute tab offers. */
const ATTRIBUTE_TYPES: { dataType: FieldType; label: string; icon: ReactNode }[] = [
  { dataType: 'TEXT', label: 'Text', icon: <Type className='size-4' /> },
  { dataType: 'NUMBER', label: 'Number', icon: <Hash className='size-4' /> },
  { dataType: 'CHECKBOX', label: 'Checkbox', icon: <CheckSquare className='size-4' /> },
  { dataType: 'DATE', label: 'Date', icon: <Calendar className='size-4' /> },
]

/**
 * Attribute tab (plan §4 seam 1) — declares a procedure-local `var:*` scratch
 * variable. Unlike the other tabs it inserts NO prose badge: the typed query is
 * the name, each row a `dataType`; selecting one calls `ctx.addLocalAttribute`
 * and closes the picker. The new `var:*` field then appears in script-mode
 * condition builders. Existing attributes are listed for reference (no-op).
 */
export function AttributePickerList({ query }: { query: string }) {
  const ctx = useProcedureEditorContext()
  const name = query.trim()
  const existing = (ctx?.localAttributes ?? []).filter((a) => matches(a.name, query))
  const taken = (ctx?.localAttributes ?? []).some((a) => a.name === name)

  const create = (dataType: FieldType) => {
    if (!ctx || !name || taken) return
    ctx.addLocalAttribute({ name, dataType })
    ctx.closePicker()
  }

  return (
    <Command shouldFilter={false} className='rounded-lg'>
      <CommandList>
        {!ctx && <CommandPlaceholder>Unavailable</CommandPlaceholder>}
        {ctx && !name && (
          <CommandPlaceholder>Type a name to create an attribute…</CommandPlaceholder>
        )}
        {ctx && name && !taken && (
          <CommandGroup aria-label='Create attribute'>
            {ATTRIBUTE_TYPES.map((t) => (
              <Row
                key={t.dataType}
                icon={t.icon}
                label={`Create “${name}” as ${t.label}`}
                value={`__create-attribute-${t.dataType}`}
                onSelect={() => create(t.dataType)}
              />
            ))}
          </CommandGroup>
        )}
        {ctx && existing.length > 0 && (
          <CommandGroup aria-label='Attributes'>
            {existing.map((a) => (
              <Row
                key={a.name}
                icon={<Variable className='size-4' />}
                label={a.name}
                value={`attribute:${a.name}`}
                onSelect={() => ctx.closePicker()}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}

/** Condition tab — inserts an IF/ELSE block (not a badge). */
export function ConditionPickerList() {
  const ctx = useProcedureEditorContext()
  return (
    <Command shouldFilter={false} className='rounded-lg'>
      <CommandList>
        {!ctx && <CommandPlaceholder>Unavailable</CommandPlaceholder>}
        {ctx && (
          <CommandGroup aria-label='Condition'>
            <Row
              icon={<GitBranch className='size-4' />}
              label='Insert condition (IF / ELSE)'
              value='__insert-condition'
              onSelect={() => ctx.insertBlock(newConditionBlock())}
            />
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
