// apps/web/src/components/schema-editor/ui/schema-field-tree.tsx

import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, PlusCircle } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { addField, removeRow, siblingNames, updateRow } from '../draft-ops'
import type { SchemaFieldDraft, SchemaPolicy } from '../schema-draft'
import { SchemaFieldCard } from './schema-field-card'
import { SchemaFieldEditCard } from './schema-field-edit-card'

/** 20px per nesting level — matches the original editor exactly. */
const INDENT = 20

interface SchemaFieldTreeProps {
  rows: SchemaFieldDraft[]
  onChange: (rows: SchemaFieldDraft[]) => void
  policy: SchemaPolicy
  /** Type annotation on the synthetic root (e.g. `array of objects` for an
   *  array-of-objects root). Defaults to `object`. */
  rootTypeLabel?: string
}

/**
 * The Visual tab — the original editor's indented card tree on the draft model.
 * A synthetic `structured_output` object root holds the fields; nesting draws
 * vertical connector lines with collapse chevrons that sit on the parent line.
 * Hover swaps a row's read card for the in-place edit card; hover is tracked at
 * the tree level and set enter-only (cleared on the container's mouseleave), so
 * row-to-row moves make exactly one transition — no timers. A field actively
 * being typed in stays open via `focusedId` regardless of the pointer.
 */
export function SchemaFieldTree({
  rows,
  onChange,
  policy,
  rootTypeLabel = 'object',
}: SchemaFieldTreeProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const enter = useCallback((id: string) => {
    setHoveredId((prev) => (prev === id ? prev : id))
  }, [])

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleAdd = useCallback(
    (parentId: string | null) => {
      const result = addField(rows, parentId)
      onChange(result.rows)
      setHoveredId(result.id)
    },
    [rows, onChange]
  )

  // Exactly one row edits at a time: a row being typed in (focusedId) holds the
  // edit card regardless of the pointer, so hover is suppressed while focused —
  // otherwise hovering a sibling mid-edit would open a second card.
  const editingId = focusedId ?? hoveredId

  const renderNode = (row: SchemaFieldDraft, depth: number): ReactNode => {
    const isContainer = row.kind === 'object' || row.kind === 'array'
    const childList =
      row.kind === 'object' ? row.children : row.kind === 'array' ? row.items?.children : undefined
    const hasChildren = !!childList && childList.length > 0
    const isCollapsed = collapsed.has(row.id)
    const isEditing = editingId === row.id

    return (
      <div className='relative' key={row.id}>
        <div className='relative z-10' style={{ paddingLeft: depth * INDENT }}>
          {depth > 0 && hasChildren && (
            <div
              className='absolute top-0 z-10 flex h-7 w-5 items-center bg-primary-100 px-0.5'
              style={{ left: (depth - 1) * INDENT }}>
              <button
                type='button'
                className='py-0.5 text-tertiary hover:text-accent'
                onClick={() => toggleCollapse(row.id)}>
                {isCollapsed ? (
                  <ChevronRight className='h-4 w-4' />
                ) : (
                  <ChevronDown className='h-4 w-4' />
                )}
              </button>
            </div>
          )}

          <div onMouseEnter={() => enter(row.id)}>
            {isEditing ? (
              <SchemaFieldEditCard
                row={row}
                siblingNames={siblingNames(rows, row.id)}
                policy={policy}
                onChange={(next) => onChange(updateRow(rows, row.id, () => next))}
                onDelete={() => {
                  setFocusedId(null)
                  setHoveredId(null)
                  onChange(removeRow(rows, row.id))
                }}
                onAddChild={() => handleAdd(row.id)}
                onFocusEditing={(editing) => setFocusedId(editing ? row.id : null)}
              />
            ) : (
              <SchemaFieldCard row={row} />
            )}
          </div>
        </div>

        {/* Vertical connector down the left of this node's subtree. */}
        <div
          className={cn(
            'absolute z-0 flex w-5 justify-center',
            row.description ? 'top-12 h-[calc(100%-3rem)]' : 'top-7 h-[calc(100%-1.75rem)]'
          )}
          style={{ left: depth * INDENT }}>
          <Separator
            orientation='vertical'
            className={cn('mx-0', isEditing ? 'bg-divider-deep' : 'bg-primary-200')}
          />
        </div>

        {/* Children only — nested fields are added from the parent's edit card
            ("Add child field"), so there's no per-level Add field button. */}
        {isContainer && !isCollapsed && childList?.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div
      className='h-full overflow-y-auto rounded-xl bg-primary-100 p-1 pl-2'
      onMouseLeave={() => setHoveredId(null)}>
      {/* Synthetic object root, matching the original editor. */}
      <div className='relative'>
        <div className='relative z-10'>
          <div className='flex h-7 items-center gap-x-1 pl-1 pr-0.5'>
            <span className='border border-transparent px-1 py-px font-semibold text-sm text-primary-800'>
              structured_output
            </span>
            <span className='px-1 py-0.5 text-xs text-muted-foreground'>{rootTypeLabel}</span>
          </div>
        </div>
        <div className='absolute top-7 z-0 flex h-[calc(100%-1.75rem)] w-5 justify-center left-0'>
          <Separator orientation='vertical' className='mx-0 bg-primary-200' />
        </div>
        {rows.map((row) => renderNode(row, 1))}
        <AddField depth={1} onClick={() => handleAdd(null)} />
      </div>
    </div>
  )
}

function AddField({ depth, onClick }: { depth: number; onClick: () => void }) {
  return (
    <div className='py-2' style={{ paddingLeft: depth * INDENT }}>
      <Button size='sm' variant='outline' onClick={onClick}>
        <PlusCircle className='size-3.5' />
        Add field
      </Button>
    </div>
  )
}
