// apps/web/src/components/data-import/column-mapping/column-mapping-row.tsx

'use client'

import type { ImportableField, ImportStrategyMode, ResolutionType } from '@auxx/lib/import/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ArrowRight, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { useResource } from '~/components/resources'
import type { ColumnMappingUI } from '../types'
import type { ColumnPolicyPatch } from './column-policy-popover'
import { FieldPicker } from './field-picker'
import { UniquenessSignal } from './identifier-toggle'
import { MappingControls } from './mapping-controls'

/**
 * A relation mapped with no match field is UNRESOLVABLE.
 *
 * `getDisplayContent` used to fall through to a plain `<span>{label}</span>` in
 * that state, so it rendered identically to a finished mapping while the
 * resolver could never match a single value. The server now always persists an
 * explicit `matchField`, which makes the state unreachable, and this check
 * stays anyway. A state the engine rejects must not be a state the UI calls
 * finished, and the next code path that forgets to set one should surface here
 * rather than in a support ticket.
 */
export function isMappingIncomplete(
  mapping: ColumnMappingUI,
  field: ImportableField | undefined
): boolean {
  if (!field || !mapping.isMapped) return false
  return field.isRelation && !mapping.matchField
}

interface ColumnMappingRowProps {
  mapping: ColumnMappingUI
  availableFields: ImportableField[]
  usedFieldKeys: string[]
  isActive: boolean
  /** Job-level import mode, decides whether update policy is worth showing. */
  mode: ImportStrategyMode
  /** How many OTHER columns carry the identity flag. */
  otherIdentifierCount: number
  /** Disables the row's write controls while a save is in flight. */
  isSaving?: boolean
  onClick: () => void
  onChange: (fieldKey: string | null, matchField?: string) => void
  onToggleIdentifier: (next: boolean) => void
  onPolicyChange: (patch: ColumnPolicyPatch) => void
  /** How this column's cells are read. Offered only where more than one type is valid. */
  onResolutionTypeChange: (next: ResolutionType) => void
  /** Which character marks decimals in this column's cells; null is per-cell detection. */
  onDecimalSeparatorChange: (next: '.' | ',' | null) => void
}

/**
 * Single row in the column mapping list.
 * Three columns: CSV Column (0.4) | Arrow (0.2) | Maps To (0.4)
 *
 * The "Maps To" cell is a button group in reading order: field combobox (what
 * the column means), then resolution type (how its cells are read), then
 * identity, then policy, then clear. All of them live HERE rather than in the
 * picker, the picker closes on selection and resets its drill-down state, so a
 * control inside it costs a reopen and a two-level re-navigation per change.
 */
export function ColumnMappingRow({
  mapping,
  availableFields,
  usedFieldKeys,
  isActive,
  mode,
  otherIdentifierCount,
  isSaving,
  onClick,
  onChange,
  onToggleIdentifier,
  onPolicyChange,
  onResolutionTypeChange,
  onDecimalSeparatorChange,
}: ColumnMappingRowProps) {
  const [open, setOpen] = useState(false)

  // Find the selected field
  const selectedField = availableFields.find((f) => f.key === mapping.targetFieldKey)

  // Get target resource for relationship fields
  const { resource: targetResource } = useResource(
    selectedField?.relationConfig?.relatedEntityDefinitionId ?? null
  )

  const isIncomplete = isMappingIncomplete(mapping, selectedField)
  const isFlagged = mapping.identityRole?.kind === 'match'

  // Build display label including match field for relationships
  const getDisplayContent = () => {
    if (!selectedField) return <span>Select field...</span>

    if (selectedField.isRelation && mapping.matchField && targetResource) {
      // Use SmartBreadcrumb for path display with EntityIcon prefix
      return (
        <span className='flex min-w-0 items-center gap-1 flex-1'>
          <EntityIcon
            iconId={targetResource.icon}
            color={'color' in targetResource ? targetResource.color : undefined}
            size='xs'
            className='shrink-0'
          />
          <SmartBreadcrumb
            segments={[
              { id: 'field', label: selectedField.label },
              { id: 'match', label: mapping.matchField },
            ]}
            mode='display'
            size='sm'
            className='min-w-0'
          />
        </span>
      )
    }

    if (isIncomplete) {
      return (
        <span className='flex min-w-0 items-center gap-1.5 flex-1 text-amber-600 dark:text-amber-500'>
          <AlertTriangle className='size-3.5 shrink-0' />
          <span className='truncate'>{selectedField.label}</span>
          <span className='truncate text-xs opacity-80'>, pick a match field</span>
        </span>
      )
    }

    return <span>{selectedField.label}</span>
  }

  const handleChange = (fieldKey: string | null, matchField?: string) => {
    onChange(fieldKey, matchField)
  }

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center px-3 py-2 ps-6 transition-colors',
        isActive ? 'bg-primary-200/50' : 'hover:bg-primary-100'
      )}
      onClick={onClick}>
      {/* CSV Column name - 40% */}
      <div className='min-w-0 flex-[0.4]'>
        <div className='flex items-center gap-2'>
          <span className='truncate text-base font-medium'>{mapping.columnName}</span>
          {mapping.suggestedField && !mapping.isMapped && (
            <Badge variant='outline' className='shrink-0 text-xs'>
              suggested
            </Badge>
          )}
        </div>
      </div>

      {/* Arrow - 20% */}
      <div className='flex flex-[0.2] justify-start'>
        <ArrowRight
          className={cn(
            'size-4 transition-colors',
            isIncomplete
              ? 'text-amber-600 dark:text-amber-500'
              : mapping.isMapped
                ? 'text-primary-600'
                : 'text-muted-foreground'
          )}
        />
      </div>

      {/* Target field selector - 40% */}
      <div className='min-w-0 flex-[0.4]' onClick={(e) => e.stopPropagation()}>
        <div className='flex items-center gap-0'>
          <div className='flex-1 min-w-0'>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  size='sm'
                  role='combobox'
                  aria-expanded={open}
                  className={cn(
                    'w-full justify-between',
                    mapping.targetFieldKey && 'rounded-r-none border-r-0',
                    !mapping.targetFieldKey && 'text-muted-foreground',
                    isIncomplete && 'border-amber-500/60'
                  )}>
                  {getDisplayContent()}
                  <ChevronsUpDown className='ml-2 shrink-0 opacity-50' />
                </Button>
              </PopoverTrigger>
              <FieldPicker
                open={open}
                onOpenChange={setOpen}
                fields={availableFields}
                value={mapping.targetFieldKey}
                matchField={mapping.matchField}
                usedFieldKeys={usedFieldKeys}
                onChange={handleChange}
              />
            </Popover>
          </div>

          <MappingControls
            mapping={mapping}
            field={selectedField}
            targetResource={targetResource}
            mode={mode}
            otherIdentifierCount={otherIdentifierCount}
            isSaving={isSaving}
            onClear={() => onChange(null)}
            onToggleIdentifier={onToggleIdentifier}
            onPolicyChange={onPolicyChange}
            onResolutionTypeChange={onResolutionTypeChange}
            onDecimalSeparatorChange={onDecimalSeparatorChange}
          />
        </div>

        {/* Per-FILE uniqueness, beside the identity toggle that made it matter */}
        {isFlagged && (
          <UniquenessSignal
            distinctValueCount={mapping.distinctValueCount}
            totalValueCount={mapping.totalValueCount}
          />
        )}
      </div>
    </div>
  )
}
