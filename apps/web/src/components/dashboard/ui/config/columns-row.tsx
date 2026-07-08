// apps/web/src/components/dashboard/ui/config/columns-row.tsx
'use client'

// The record-list widget's column editor (plan 13). A `FieldPanelRow` whose
// trigger shows a "N columns" badge, opening a column-manager popover modeled on
// the records table's `ColumnManager` — a drag-sortable Visible-columns list
// (array order = render order), remove-only rows, and an "Add column" entry that
// drills into the field picker IN-PLACE via `CommandNavigation` (no nested
// popover), reusing the shared `FieldPickerInnerContent` for relationship-path
// drill-down.
//
// The PRIMARY display field is special: it's always the pinned first column
// (rendered by `use-record-list-columns`), so here it shows as a LOCKED row —
// not draggable, not removable, not addable — and is filtered out of the
// manageable set. Any legacy `config.columns` entry for it is dropped on the
// next edit (mutations write the managed, primary-less set back).
//
// NOT `ColumnManager` reused directly: that's welded to the dynamic-table
// runtime. This is a config-driven twin over the same PURE primitives, driven by
// `config.columns` + `onChange`. The `externalNavigation` adapter (mirrors
// `AddColumnStack`) lets the field picker share this popover's nav stack.

import type { WidgetFieldRef, WidgetSource } from '@auxx/lib/dashboards/client'
import {
  type FieldReference,
  isFieldPath,
  type ResourceFieldId,
  toFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import {
  Command,
  CommandBreadcrumb,
  CommandDescription,
  CommandGroup,
  CommandList,
  CommandNavigableItem,
  CommandNavigation,
  CommandSeparator,
  CommandSortable,
  CommandSortableItem,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { type BreadcrumbSegment, SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { Lock, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  FieldPickerInnerContent,
  type FieldPickerNavigationItem,
} from '~/components/pickers/field-picker'
import { useResource } from '~/components/resources'
import { useFields } from '~/components/resources/hooks/use-field'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { columnId } from '../../lib/column-ref'
import { sourceResourceId } from '../../lib/widget-source'

/** Root nav marker for the "Add column" drill; siblings are field-picker items. */
type AddColumnNavItem = NavigationItem & { type: 'add-column' }
type ColumnNavItem = AddColumnNavItem | FieldPickerNavigationItem
const ADD_COLUMN_ITEM: AddColumnNavItem = {
  id: 'add-column',
  label: 'Add column',
  type: 'add-column',
}

/** The pinned primary display column (always first, locked). */
interface Primary {
  columnId: ResourceFieldId
  label: string
}

interface ManagerProps {
  source: WidgetSource
  /** Manageable columns only — the primary field is excluded. */
  columns: WidgetFieldRef[]
  onChange: (columns: WidgetFieldRef[]) => void
  primary: Primary | null
}

/** Resolve the resource's primary display field → its column id + label. */
function usePrimary(source: WidgetSource): Primary | null {
  const entityDefinitionId = sourceResourceId(source)
  const { resource } = useResource(entityDefinitionId)
  return useMemo(() => {
    const fieldId = resource?.display.primaryDisplayField?.id ?? resource?.fields[0]?.id
    if (!fieldId) return null
    const label = resource?.fields.find((f) => f.id === fieldId)?.label ?? 'Primary'
    return { columnId: toResourceFieldId(entityDefinitionId, toFieldId(fieldId)), label }
  }, [resource, entityDefinitionId])
}

/** A labeled `FieldPanelRow` wrapping the column-manager popover. */
export function ColumnsRow({
  source,
  columns,
  onChange,
}: {
  source: WidgetSource
  columns: WidgetFieldRef[]
  onChange: (columns: WidgetFieldRef[]) => void
}) {
  const [open, setOpen] = useState(false)
  const primary = usePrimary(source)

  // The primary is the always-pinned first column; keep it out of the managed
  // set (and drop any legacy entry for it on the next write).
  const managed = useMemo(
    () => (primary ? columns.filter((c) => columnId(c) !== primary.columnId) : columns),
    [columns, primary]
  )
  const count = managed.length + (primary ? 1 : 0)

  return (
    <FieldPanelRow title='Columns'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <PickerTrigger
            hasValue={count > 0}
            placeholder='Select columns…'
            className='w-full ps-0 pe-1'>
            <Badge variant='secondary'>
              {count} column{count === 1 ? '' : 's'}
            </Badge>
          </PickerTrigger>
        </PopoverTrigger>

        <PopoverContent className='w-[280px] p-0' align='start'>
          <CommandNavigation<ColumnNavItem>>
            <Command shouldFilter={false}>
              <CommandBreadcrumb rootLabel='Columns' />
              <ManagerContent
                source={source}
                columns={managed}
                onChange={onChange}
                primary={primary}
              />
            </Command>
          </CommandNavigation>
        </PopoverContent>
      </Popover>
    </FieldPanelRow>
  )
}

/** Router: the visible-columns root, or the field picker once "Add column" is entered. */
function ManagerContent(props: ManagerProps) {
  const { current } = useCommandNavigation<ColumnNavItem>()
  const inAddMode =
    current?.type === 'add-column' || (current != null && 'resourceFieldId' in current)
  return inAddMode ? <AddColumnStack {...props} /> : <RootStack {...props} />
}

/** Locked primary + sortable managed columns + "Add column" drill entry. */
function RootStack({ columns, onChange, primary }: ManagerProps) {
  const { push } = useCommandNavigation<ColumnNavItem>()

  // Resolve every hop's label in one shallow-compared subscription (mirrors the
  // reference `ColumnManager`'s pathFieldMap), so no per-row field hook.
  const allHops = useMemo(() => {
    const seen = new Map<string, ResourceFieldId>()
    for (const ref of columns) {
      for (const hop of isFieldPath(ref) ? ref : [ref]) seen.set(hop, hop)
    }
    return [...seen.values()]
  }, [columns])
  const fields = useFields(allHops)
  const labelMap = useMemo(() => {
    const map = new Map<string, string>()
    allHops.forEach((rfId, i) => {
      const label = fields[i]?.label
      if (label) map.set(rfId, label)
    })
    return map
  }, [allHops, fields])

  // Reorder maps the new id order back to refs (ids are unique — dedupe on add).
  const refById = useMemo(
    () => new Map(columns.map((ref) => [columnId(ref), ref] as const)),
    [columns]
  )
  const handleReorder = (ids: string[]) => {
    const next = ids
      .map((id) => refById.get(id))
      .filter((r): r is WidgetFieldRef => r !== undefined)
    if (next.length === columns.length) onChange(next)
  }
  const handleRemove = (index: number) => onChange(columns.filter((_, i) => i !== index))

  return (
    <CommandList>
      <CommandGroup heading='Visible columns'>
        {primary && <PrimaryRow label={primary.label} />}

        {columns.length === 0 ? (
          !primary && <CommandDescription>No columns</CommandDescription>
        ) : (
          <CommandSortable items={columns.map(columnId)} onReorder={handleReorder}>
            {columns.map((ref, i) => (
              <CommandSortableItem key={columnId(ref)} id={columnId(ref)} className='py-0 pe-0.5'>
                <span className='truncate flex-1 flex items-center'>
                  <ColumnLabel fieldRef={ref} labelMap={labelMap} />
                </span>
                <button
                  type='button'
                  aria-label='Remove column'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(i)
                  }}
                  className='shrink-0 size-6.5 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'>
                  <X className='size-3.5' />
                </button>
              </CommandSortableItem>
            ))}
          </CommandSortable>
        )}
      </CommandGroup>

      <CommandSeparator />

      <CommandGroup>
        <CommandNavigableItem
          item={ADD_COLUMN_ITEM}
          hasChildren
          onSelect={() => push(ADD_COLUMN_ITEM)}>
          <Plus />
          <span>Add column</span>
        </CommandNavigableItem>
      </CommandGroup>
    </CommandList>
  )
}

/** The pinned primary display column — locked (no grip, no remove). */
function PrimaryRow({ label }: { label: string }) {
  return (
    <div className='flex items-center gap-1.5 ps-2 pe-2 py-1.5 text-sm'>
      <Lock className='size-3.5 shrink-0 text-muted-foreground' />
      <span className='truncate flex-1'>{label}</span>
      <span className='shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
        Primary
      </span>
    </div>
  )
}

/**
 * The "Add column" page: the shared field picker embedded into THIS popover's
 * nav stack. The `externalNavigation` adapter filters the stack to field-picker
 * items (dropping our `add-column` marker) and treats the add-column entry as
 * the picker's root — same shape as the records table's `AddColumnStack`.
 */
function AddColumnStack({ source, columns, onChange, primary }: ManagerProps) {
  const { stack, current, push, pop, reset } = useCommandNavigation<ColumnNavItem>()

  const fieldPickerStack = useMemo(
    () => stack.filter((i): i is FieldPickerNavigationItem => 'resourceFieldId' in i),
    [stack]
  )
  const fieldPickerCurrent =
    current && 'resourceFieldId' in current ? (current as FieldPickerNavigationItem) : null

  const externalNavigation = useMemo(
    () => ({
      push: (item: FieldPickerNavigationItem) => push(item),
      pop,
      stack: fieldPickerStack,
      current: fieldPickerCurrent,
      // "At root" for the picker = the add-column entry (no relationship drilled yet).
      isAtRoot: fieldPickerStack.length === 0,
    }),
    [push, pop, fieldPickerStack, fieldPickerCurrent]
  )

  // Exclude already-chosen direct fields AND the primary (it's always pinned).
  const excludeFields = useMemo(() => {
    const direct = columns.filter((c): c is ResourceFieldId => !isFieldPath(c))
    return primary ? [...direct, primary.columnId] : direct
  }, [columns, primary])

  const handleSelectField = (ref: FieldReference) => {
    const widgetRef = ref as WidgetFieldRef
    if (!columns.some((c) => columnId(c) === columnId(widgetRef))) {
      onChange([...columns, widgetRef])
    }
    reset() // back to the visible-columns root so the new column shows
  }

  return (
    <FieldPickerInnerContent
      entityDefinitionId={sourceResourceId(source)}
      excludeFields={excludeFields}
      mode='single'
      closeOnSelect={false} // navigation is managed via reset()
      onSelect={handleSelectField}
      searchPlaceholder='Search fields…'
      externalNavigation={externalNavigation}
    />
  )
}

/** A column's label: plain text for a direct field, breadcrumb for a path. */
function ColumnLabel({
  fieldRef,
  labelMap,
}: {
  fieldRef: WidgetFieldRef
  labelMap: Map<string, string>
}) {
  if (isFieldPath(fieldRef)) {
    const segments: BreadcrumbSegment[] = fieldRef.map((hop) => ({
      id: hop,
      label: labelMap.get(hop) ?? hop,
    }))
    return (
      <SmartBreadcrumb segments={segments} mode='display' size='sm' className='flex-1 min-w-0' />
    )
  }
  return <span className='truncate text-sm'>{labelMap.get(fieldRef) ?? fieldRef}</span>
}
