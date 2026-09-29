// apps/web/src/components/data-import/column-mapping/field-mapping-row.tsx

'use client'

import type { ImportableField, ImportStrategyMode, ResolutionType } from '@auxx/lib/import/client'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ArrowLeft, Ban, Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { useResource } from '~/components/resources'
import type { ColumnMappingUI } from '../types'
import { isMappingIncomplete } from './column-mapping-row'
import type { ColumnPolicyPatch } from './column-policy-popover'
import { FieldPicker } from './field-picker'
import { UniquenessSignal } from './identifier-toggle'
import { MappingControls } from './mapping-controls'

interface FieldMappingRowProps {
  field: ImportableField
  /** The column currently feeding this field, if any. */
  mapping: ColumnMappingUI | undefined
  /** Every file column, for the picker. */
  columns: ColumnMappingUI[]
  /** Label of the field each mapped column feeds, keyed by field key. */
  fieldLabels: ReadonlyMap<string, string>
  isActive: boolean
  mode: ImportStrategyMode
  otherIdentifierCount: number
  isSaving?: boolean
  onClick: () => void
  /** Map `columnIndex` to this field; moves it if another field holds it. */
  onSelectColumn: (columnIndex: number, matchField?: string) => void
  onUnmap: () => void
  onToggleIdentifier: (next: boolean) => void
  onPolicyChange: (patch: ColumnPolicyPatch) => void
  onResolutionTypeChange: (next: ResolutionType) => void
  onDecimalSeparatorChange: (next: '.' | ',' | null) => void
}

/** One target field and the file column that feeds it. */
export function FieldMappingRow({
  field,
  mapping,
  columns,
  fieldLabels,
  isActive,
  mode,
  otherIdentifierCount,
  isSaving,
  onClick,
  onSelectColumn,
  onUnmap,
  onToggleIdentifier,
  onPolicyChange,
  onResolutionTypeChange,
  onDecimalSeparatorChange,
}: FieldMappingRowProps) {
  const [columnOpen, setColumnOpen] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const { resource: targetResource } = useResource(
    field.relationConfig?.relatedEntityDefinitionId ?? null
  )

  const isRequired = field.importTier === 'required'
  const isIncomplete = mapping ? isMappingIncomplete(mapping, field) : false
  const matchLabel =
    mapping?.matchField &&
    (targetResource?.fields.find((f) => f.key === mapping.matchField)?.label ?? mapping.matchField)

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center px-3 py-2 ps-6 transition-colors',
        isActive ? 'bg-primary-200/50' : 'hover:bg-primary-100'
      )}
      onClick={onClick}>
      <div className='min-w-0 flex-[0.4]'>
        <div className='flex items-center gap-1'>
          <span className='truncate text-base font-medium'>{field.label}</span>
          {isRequired && <span className='text-destructive'>*</span>}
        </div>
        {field.isRelation && mapping && (
          <Popover open={matchOpen} onOpenChange={setMatchOpen}>
            <PopoverTrigger asChild>
              <button
                type='button'
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'text-xs text-muted-foreground hover:text-foreground hover:underline',
                  isIncomplete && 'text-amber-600 dark:text-amber-500'
                )}>
                {matchLabel ? `match by ${matchLabel}` : 'pick a match field'}
              </button>
            </PopoverTrigger>
            <FieldPicker
              open={matchOpen}
              onOpenChange={setMatchOpen}
              fields={[field]}
              value={field.key}
              matchField={mapping.matchField}
              onChange={(fieldKey, matchField) => {
                if (!fieldKey) onUnmap()
                else onSelectColumn(mapping.sourceColumnIndex, matchField)
              }}
            />
          </Popover>
        )}
      </div>

      <div className='flex flex-[0.2] justify-start'>
        <ArrowLeft
          className={cn(
            'size-4 transition-colors',
            isIncomplete
              ? 'text-amber-600 dark:text-amber-500'
              : mapping
                ? 'text-primary-600'
                : isRequired
                  ? 'text-amber-600 dark:text-amber-500'
                  : 'text-muted-foreground'
          )}
        />
      </div>

      <div className='min-w-0 flex-[0.4]' onClick={(e) => e.stopPropagation()}>
        <div className='flex items-center gap-0'>
          <div className='flex-1 min-w-0'>
            <Popover open={columnOpen} onOpenChange={setColumnOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  size='sm'
                  role='combobox'
                  aria-expanded={columnOpen}
                  className={cn(
                    'w-full justify-between',
                    mapping && 'rounded-r-none border-r-0',
                    !mapping && 'text-muted-foreground',
                    isIncomplete && 'border-amber-500/60'
                  )}>
                  <span className='flex min-w-0 items-center gap-1.5'>
                    {isIncomplete && <AlertTriangle className='size-3.5 shrink-0 text-amber-600' />}
                    <span className='truncate'>{mapping?.columnName ?? 'Not mapped'}</span>
                  </span>
                  <ChevronsUpDown className='ml-2 shrink-0 opacity-50' />
                </Button>
              </PopoverTrigger>
              <ColumnPickerContent
                columns={columns}
                value={mapping?.sourceColumnIndex ?? null}
                fieldKey={field.key}
                fieldLabels={fieldLabels}
                onSelect={(columnIndex) => {
                  setColumnOpen(false)
                  if (columnIndex === null) onUnmap()
                  else if (columnIndex !== mapping?.sourceColumnIndex) onSelectColumn(columnIndex)
                }}
              />
            </Popover>
          </div>

          {mapping && (
            <MappingControls
              mapping={mapping}
              field={field}
              targetResource={targetResource}
              mode={mode}
              otherIdentifierCount={otherIdentifierCount}
              isSaving={isSaving}
              onClear={onUnmap}
              onToggleIdentifier={onToggleIdentifier}
              onPolicyChange={onPolicyChange}
              onResolutionTypeChange={onResolutionTypeChange}
              onDecimalSeparatorChange={onDecimalSeparatorChange}
            />
          )}
        </div>

        {mapping?.identityRole?.kind === 'match' && (
          <UniquenessSignal
            distinctValueCount={mapping.distinctValueCount}
            totalValueCount={mapping.totalValueCount}
          />
        )}
      </div>
    </div>
  )
}

interface ColumnPickerContentProps {
  columns: ColumnMappingUI[]
  value: number | null
  fieldKey: string
  fieldLabels: ReadonlyMap<string, string>
  onSelect: (columnIndex: number | null) => void
}

/** Combobox body listing the file's columns with a sample value each. */
function ColumnPickerContent({
  columns,
  value,
  fieldKey,
  fieldLabels,
  onSelect,
}: ColumnPickerContentProps) {
  return (
    <PopoverContent className='w-[320px] p-0' align='start'>
      <Command>
        <CommandInput placeholder='Search columns...' />
        <CommandList>
          <CommandEmpty>No columns found.</CommandEmpty>
          {value !== null && (
            <>
              <CommandGroup>
                <CommandItem
                  value='__unmap__'
                  onSelect={() => onSelect(null)}
                  className='flex items-center gap-2 text-muted-foreground'>
                  <Ban />
                  <span>Don't import this field</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading='Columns in your file'>
            {columns.map((column) => {
              const isSelected = column.sourceColumnIndex === value
              const usedBy =
                column.isMapped && column.targetFieldKey && column.targetFieldKey !== fieldKey
                  ? (fieldLabels.get(column.targetFieldKey) ?? column.targetFieldKey)
                  : null
              const sample = column.sampleValues.find((v) => v.trim() !== '')
              return (
                <CommandItem
                  key={column.sourceColumnIndex}
                  value={`${column.sourceColumnIndex}:${column.columnName}`}
                  onSelect={() => onSelect(column.sourceColumnIndex)}
                  className='flex items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <Check className={cn(!isSelected && 'invisible')} />
                    <div className='min-w-0'>
                      <div className='truncate'>{column.columnName}</div>
                      {sample && (
                        <div className='truncate font-mono text-xs text-muted-foreground'>
                          {sample}
                        </div>
                      )}
                    </div>
                  </div>
                  {usedBy && (
                    <span className='shrink-0 text-xs text-muted-foreground'>used by {usedBy}</span>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  )
}
