// apps/web/src/components/data-import/column-mapping/column-mapping-row.tsx

'use client'

import { useState } from 'react'
import { ArrowRight, ChevronsUpDown, Trash2 } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { FieldPicker } from './field-picker'
import { cn } from '@auxx/ui/lib/utils'
import { useResource } from '~/components/resources'
import { EntityIcon } from '~/components/pickers/icon-picker'
import type { ColumnMappingUI } from '../types'
import type { ImportableField } from '@auxx/lib/import'

interface ColumnMappingRowProps {
  mapping: ColumnMappingUI
  availableFields: ImportableField[]
  usedFieldKeys: string[]
  isActive: boolean
  onClick: () => void
  onChange: (fieldKey: string | null, matchField?: string) => void
}

/**
 * Single row in the column mapping list.
 * Three columns: CSV Column (0.4) | Arrow (0.2) | Maps To (0.4)
 */
export function ColumnMappingRow({
  mapping,
  availableFields,
  usedFieldKeys,
  isActive,
  onClick,
  onChange,
}: ColumnMappingRowProps) {
  const [open, setOpen] = useState(false)

  // Find the selected field
  const selectedField = availableFields.find((f) => f.key === mapping.targetFieldKey)

  // Get target resource for relationship fields
  const { resource: targetResource } = useResource(
    selectedField?.relationConfig?.targetTable ?? null
  )

  // Build display label including match field for relationships
  const getDisplayContent = () => {
    if (!selectedField) return <span>Select field...</span>

    if (selectedField.isRelation && mapping.matchField && targetResource) {
      // Use SmartBreadcrumb for path display with EntityIcon prefix
      const fullPath = `${selectedField.label} > ${mapping.matchField}`

      return (
        <span className="flex min-w-0 items-center gap-1 flex-1">
          <EntityIcon
            iconId={targetResource.icon}
            color={'color' in targetResource ? targetResource.color : undefined}
            size="xs"
            className="shrink-0"
          />
          <SmartBreadcrumb
            segments={[
              { id: 'field', label: selectedField.label },
              { id: 'match', label: mapping.matchField },
            ]}
            mode="display"
            size="sm"
            className="min-w-0"
          />
        </span>
      )
    }

    return <span>{selectedField.label}</span>
  }

  const handleChange = (fieldKey: string | null, matchField?: string) => {
    onChange(fieldKey, matchField)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(null)
  }

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center px-3 py-2 ps-6 transition-colors',
        isActive ? 'bg-primary-200/50' : 'hover:bg-primary-100'
      )}
      onClick={onClick}>
      {/* CSV Column name - 40% */}
      <div className="min-w-0 flex-[0.4]">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-medium">{mapping.columnName}</span>
          {mapping.suggestedField && !mapping.isMapped && (
            <Badge variant="outline" className="shrink-0 text-xs">
              suggested
            </Badge>
          )}
        </div>
      </div>

      {/* Arrow - 20% */}
      <div className="flex flex-[0.2] justify-start">
        <ArrowRight
          className={cn(
            'size-4 transition-colors',
            mapping.isMapped ? 'text-primary-600' : 'text-muted-foreground'
          )}
        />
      </div>

      {/* Target field selector - 40% */}
      <div className="min-w-0 flex-[0.4]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0">
          <div className="flex-1">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  role="combobox"
                  aria-expanded={open}
                  className={cn(
                    'w-full justify-between',
                    mapping.targetFieldKey && 'rounded-r-none border-r-0',
                    !mapping.targetFieldKey && 'text-muted-foreground'
                  )}>
                  {getDisplayContent()}
                  <ChevronsUpDown className="ml-2 shrink-0 opacity-50" />
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
          {/* Clear button */}
          {mapping.targetFieldKey && (
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-l-none bg-linear-0 shadow-none hover:inset-shadow-none hover:border-destructive/20 hover:from-destructive/5 hover:to-destructive/5 hover:text-destructive hover:shadow-xs"
              onClick={handleClear}>
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
