// apps/web/src/components/print/ui/print-column-picker.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { ExportColumn, PrintStyle } from '@auxx/lib/export/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { isFieldPath } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { EmptySection } from '@auxx/ui/components/section'
import { type BreadcrumbSegment, SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { SortableList } from '@auxx/ui/components/sortable'
import { SortableTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { FieldPicker } from '~/components/pickers/field-picker'
import { useResourceProperty } from '~/components/resources'
import { columnKey, type UsePrintColumnsResult } from '../hooks/use-print-columns'

interface PrintColumnPickerProps {
  columns: UsePrintColumnsResult
  entityDefinitionId: string
  /** List calls the picked entries "columns"; detail calls the exact same entries "fields"
   * (the label/value blocks on each record's sheet) — same picker, different word. */
  style: PrintStyle
}

/**
 * Print wizard "Content" page — the column/field list `usePrintColumns` drives, shared by the
 * `list` style (table columns) and the `detail` style (label/value field blocks). Selected
 * entries render as `SortableTreeRow`s (hover grip to reorder, hover `Trash2` to remove;
 * drilled paths as breadcrumbs); "Add" opens the regular `FieldPicker` popover with search +
 * relationship drill-down, staying open for multi-add.
 */
export function PrintColumnPicker({ columns, entityDefinitionId, style }: PrintColumnPickerProps) {
  const { selected, excludeFields, hopFields, addField, removeColumn, reorder } = columns
  const noun = style === 'detail' ? 'field' : 'column'

  return (
    <div className='flex flex-col gap-1'>
      {selected.length === 0 ? (
        <EmptySection
          title={`No ${noun}s selected`}
          description='Add at least one below to print.'
        />
      ) : (
        <SortableList items={selected.map(columnKey)} onReorder={reorder} className='gap-0.5'>
          {selected.map((column) => (
            <PrintColumnRow
              key={columnKey(column)}
              column={column}
              hopFields={hopFields}
              noun={noun}
              onRemove={() => removeColumn(column)}
            />
          ))}
        </SortableList>
      )}

      <FieldPicker
        entityDefinitionId={entityDefinitionId}
        excludeFields={excludeFields}
        mode='single'
        closeOnSelect={false}
        onSelect={addField}
        searchPlaceholder={`Search ${noun}s…`}
        trigger={
          <Button variant='ghost' size='sm' className='justify-start text-muted-foreground'>
            <Plus />
            Add {noun}
          </Button>
        }
      />
    </div>
  )
}

/** One selected column: leaf-field type icon, label (breadcrumb for paths), hover remove. */
function PrintColumnRow({
  column,
  hopFields,
  noun,
  onRemove,
}: {
  column: ExportColumn
  hopFields: Map<string, ResourceField>
  noun: string
  onRemove: () => void
}) {
  // A path column's icon/type comes from its LEAF hop — that's the field whose value prints.
  const leafHop = isFieldPath(column.fieldRef)
    ? column.fieldRef[column.fieldRef.length - 1]!
    : column.fieldRef
  const field = hopFields.get(leafHop)

  return (
    <SortableTreeRow
      id={columnKey(column)}
      rowClassName='bg-primary-100 hover:bg-muted/50'
      icon={<ColumnFieldIcon field={field} />}
      title={
        isFieldPath(column.fieldRef) ? (
          <SmartBreadcrumb
            segments={column.fieldRef.map(
              (hop): BreadcrumbSegment => ({ id: hop, label: hopFields.get(hop)?.label ?? hop })
            )}
            mode='display'
            size='sm'
          />
        ) : (
          column.label
        )
      }
      actions={
        <TreeRowButton variant='destructive' tooltipText={`Remove ${noun}`} onClick={onRemove}>
          <Trash2 />
        </TreeRowButton>
      }
    />
  )
}

/**
 * Field-type icon matching the field picker's rows (field-item.tsx): relationship fields show
 * the target resource's icon, everything else the fieldType icon from `fieldTypeOptions`.
 */
function ColumnFieldIcon({ field }: { field: ResourceField | undefined }) {
  const relatedEntityDefinitionId = useMemo(() => {
    if (!field?.relationship) return null
    return getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
  }, [field?.relationship])
  const targetResourceProps = useResourceProperty(relatedEntityDefinitionId, ['icon', 'color'])

  if (field?.relationship && targetResourceProps) {
    return (
      <EntityIcon iconId={targetResourceProps.icon} color={targetResourceProps.color} size='xs' />
    )
  }

  const effectiveFieldType =
    (field?.fieldType as FieldType) ||
    (field?.type ? mapBaseTypeToFieldType(field.type as never) : undefined)
  const iconId = (effectiveFieldType && fieldTypeOptions[effectiveFieldType]?.iconId) ?? 'circle'
  return <EntityIcon iconId={iconId} size='xs' className='text-muted-foreground' />
}
