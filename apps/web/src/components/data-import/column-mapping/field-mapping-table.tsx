// apps/web/src/components/data-import/column-mapping/field-mapping-table.tsx

'use client'

import type { ImportStrategyMode, ResolutionType } from '@auxx/lib/import/client'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ColumnMappingUI, ImportableField } from '../types'
import type { ColumnPolicyPatch } from './column-policy-popover'
import { FieldMappingRow } from './field-mapping-row'

interface FieldMappingTableProps {
  mappings: ColumnMappingUI[]
  availableFields: ImportableField[]
  activeColumn: number | null
  mode: ImportStrategyMode
  savingColumns?: ReadonlySet<number>
  onSelectColumn: (columnIndex: number) => void
  onChange: (
    columnIndex: number,
    fieldKey: string | null,
    resolutionType: string,
    matchField?: string
  ) => void
  onToggleIdentifier: (columnIndex: number, next: boolean) => void
  onPolicyChange: (columnIndex: number, patch: ColumnPolicyPatch) => void
  onResolutionTypeChange: (columnIndex: number, next: ResolutionType) => void
  onDecimalSeparatorChange: (columnIndex: number, next: '.' | ',' | null) => void
}

/** Field-first view of the mapping: one row per target field. See plans/importer/10-field-first-mapping.md §2.2. */
export function FieldMappingTable({
  mappings,
  availableFields,
  activeColumn,
  mode,
  savingColumns,
  onSelectColumn,
  onChange,
  onToggleIdentifier,
  onPolicyChange,
  onResolutionTypeChange,
  onDecimalSeparatorChange,
}: FieldMappingTableProps) {
  // Untiered rows that lost their column here stay put; a row never vanishes mid-edit.
  const [keptKeys, setKeptKeys] = useState<ReadonlySet<string>>(new Set())
  const [addedKeys, setAddedKeys] = useState<string[]>([])
  const [addOpen, setAddOpen] = useState(false)

  const columnByField = useMemo(() => {
    const map = new Map<string, ColumnMappingUI>()
    for (const m of mappings) if (m.isMapped && m.targetFieldKey) map.set(m.targetFieldKey, m)
    return map
  }, [mappings])

  const fieldLabels = useMemo(
    () => new Map(availableFields.map((f) => [f.key, f.label])),
    [availableFields]
  )

  const rows = useMemo(() => {
    const required = availableFields.filter((f) => f.importTier === 'required')
    const recommended = availableFields.filter((f) => f.importTier === 'recommended')
    const mapped = availableFields.filter(
      (f) =>
        !f.importTier &&
        !addedKeys.includes(f.key) &&
        (columnByField.has(f.key) || keptKeys.has(f.key))
    )
    const added = addedKeys
      .map((key) => availableFields.find((f) => f.key === key))
      .filter((f): f is ImportableField => !!f && !f.importTier)
    return [...required, ...recommended, ...mapped, ...added]
  }, [availableFields, columnByField, keptKeys, addedKeys])

  const remainingFields = useMemo(() => {
    const shown = new Set(rows.map((f) => f.key))
    return availableFields.filter((f) => !shown.has(f.key))
  }, [availableFields, rows])

  const unmappedColumns = mappings.filter((m) => !m.isMapped)
  const identifierCount = mappings.filter((m) => m.identityRole?.kind === 'match').length

  const keep = (fieldKey: string | null | undefined) => {
    if (!fieldKey || keptKeys.has(fieldKey)) return
    setKeptKeys((prev) => new Set(prev).add(fieldKey))
  }

  return (
    <div className='border border-l-0 border-t-0'>
      <div className='flex items-center ps-6 px-3 py-2 bg-primary-200/50 border-b text-sm font-medium text-muted-foreground sticky sm:top-[48px] backdrop-blur-sm h-fit min-h-0 z-10'>
        <div className='flex-[0.4]'>Field</div>
        <div className='flex-[0.2] text-center' />
        <div className='flex-[0.4]'>Column from your file</div>
      </div>

      <div className='divide-y'>
        {rows.map((field) => {
          const mapping = columnByField.get(field.key)
          const columnIndex = mapping?.sourceColumnIndex
          const bound =
            <T,>(fn: (col: number, arg: T) => void) =>
            (arg: T) => {
              if (columnIndex !== undefined) fn(columnIndex, arg)
            }
          return (
            <FieldMappingRow
              key={field.key}
              field={field}
              mapping={mapping}
              columns={mappings}
              fieldLabels={fieldLabels}
              isActive={columnIndex !== undefined && activeColumn === columnIndex}
              mode={mode}
              otherIdentifierCount={
                identifierCount - (mapping?.identityRole?.kind === 'match' ? 1 : 0)
              }
              isSaving={columnIndex !== undefined && savingColumns?.has(columnIndex)}
              onClick={() => {
                if (columnIndex !== undefined) onSelectColumn(columnIndex)
              }}
              onSelectColumn={(nextColumn, matchField) => {
                const previous = mappings.find((m) => m.sourceColumnIndex === nextColumn)
                if (previous?.targetFieldKey !== field.key) keep(previous?.targetFieldKey)
                onChange(nextColumn, field.key, 'text:value', matchField)
                onSelectColumn(nextColumn)
              }}
              onUnmap={() => {
                if (columnIndex === undefined) return
                keep(field.key)
                onChange(columnIndex, null, 'text:value')
              }}
              onToggleIdentifier={bound(onToggleIdentifier)}
              onPolicyChange={bound(onPolicyChange)}
              onResolutionTypeChange={bound(onResolutionTypeChange)}
              onDecimalSeparatorChange={bound(onDecimalSeparatorChange)}
            />
          )
        })}
      </div>

      <div className='flex flex-col gap-2 border-t px-3 py-2 ps-6'>
        {remainingFields.length > 0 && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant='ghost' size='sm' className='w-fit'>
                <Plus />
                Add field
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-[280px] p-0' align='start'>
              <Command>
                <CommandInput placeholder='Search fields...' />
                <CommandList>
                  <CommandEmpty>No fields found.</CommandEmpty>
                  <CommandGroup>
                    {remainingFields.map((f) => (
                      <CommandItem
                        key={f.key}
                        value={`${f.label} ${f.key}`}
                        onSelect={() => {
                          setAddedKeys((prev) => [...prev, f.key])
                          setAddOpen(false)
                        }}>
                        {f.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}

        {unmappedColumns.length > 0 && (
          <p className='text-sm text-muted-foreground'>
            <span className='font-medium'>Not imported:</span>{' '}
            {unmappedColumns.map((m) => `"${m.columnName}"`).join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
