// apps/web/src/components/schema-editor/ui/schema-field-tree.tsx

import { BaseType } from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, PlusCircle } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { VariableTypePicker } from '~/components/workflow/ui/variable-type-picker'
import { addField, removeRow, siblingNames, typeLabelOf, updateRow } from '../draft-ops'
import type { SchemaFieldDraft, SchemaPolicy, SchemaRootKind } from '../schema-draft'
import { SchemaFieldCard } from './schema-field-card'
import { SchemaFieldEditCard } from './schema-field-edit-card'

/** 20px per nesting level — matches the original editor exactly. */
const INDENT = 20

interface SchemaFieldTreeProps {
  rows: SchemaFieldDraft[]
  onChange: (rows: SchemaFieldDraft[]) => void
  policy: SchemaPolicy
  /** Current root kind — drives the root type label / picker. The tree only
   *  renders for object / array-of-objects roots ('other' is JSON-tab only). */
  rootKind?: SchemaRootKind
  /** When provided, the root type becomes an editable object ⇄ array-of-objects
   *  picker; omitted (workflow's fixed object root) renders a static label. */
  onRootKindChange?: (kind: SchemaRootKind) => void
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
  rootKind = 'object',
  onRootKindChange,
}: SchemaFieldTreeProps) {
  const rootLabel = policy.rootLabel ?? 'structured_output'
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

        {/* Vertical connector down the left of this node's subtree. Rows are a
            single line (description is inline), so the offset is uniform. */}
        <div
          className='absolute top-7 z-0 flex h-[calc(100%-1.75rem)] w-5 justify-center'
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
              {rootLabel}
            </span>
            {onRootKindChange ? (
              <RootTypeSelector rootKind={rootKind} onChange={onRootKindChange} />
            ) : (
              <span className='px-1 py-0.5 text-xs text-muted-foreground'>
                {typeLabelOf({
                  baseType: BaseType.OBJECT,
                  isArray: rootKind === 'array-of-objects',
                })}
              </span>
            )}
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

/** Every `BaseType` except `object` — the root picker offers object only,
 *  with the Array toggle flipping object ⇄ array-of-objects. */
const ROOT_EXCLUDED_TYPES: BaseType[] = Object.values(BaseType).filter(
  (type) => type !== BaseType.OBJECT
)

/**
 * The root type control — the same `VariableTypePicker` the field edit card uses,
 * behind the same ghost trigger. The base type is pinned to `object`; the picker's
 * Array toggle is the real control, mapping to `array-of-objects`. Search is
 * hidden (a single base type), so the popover is just the toggle.
 */
function RootTypeSelector({
  rootKind,
  onChange,
}: {
  rootKind: SchemaRootKind
  onChange: (kind: SchemaRootKind) => void
}) {
  const [open, setOpen] = useState(false)
  const isArray = rootKind === 'array-of-objects'
  return (
    <VariableTypePicker
      value={{ baseType: BaseType.OBJECT, isArray }}
      onChange={(next) => onChange(next.isArray ? 'array-of-objects' : 'object')}
      excludeTypes={ROOT_EXCLUDED_TYPES}
      includeArrayToggle
      showSearch={false}
      open={open}
      onOpenChange={setOpen}
      align='start'
      popoverWidth={208}>
      <Button variant='ghost' size='xs' className={cn(open && 'bg-state-base-hover')}>
        <span className='system-xs-medium text-primary-500'>
          {typeLabelOf({ baseType: BaseType.OBJECT, isArray })}
        </span>
        <ChevronDown className='size-4 text-primary-500' />
      </Button>
    </VariableTypePicker>
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
