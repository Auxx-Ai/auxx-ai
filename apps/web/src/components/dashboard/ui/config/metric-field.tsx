// apps/web/src/components/dashboard/ui/config/metric-field.tsx
'use client'

// The two-step metric picker (plan 07), our port of Twenty's AggregateFieldPicker:
// step 1 picks the field (a "Count records" shortcut + the source's aggregable
// fields), step 2 picks the op allowed for that field (`metric-ops.ts`, kept in
// lockstep with the server's validateMetric). Selecting stores a `Metric`
// verbatim ({op, fieldRef?}); the field ref is the branded ResourceFieldId the
// resource store already holds. Trigger reads "Sum of Amount" / "Count of records".

import type { Metric, WidgetSource } from '@auxx/lib/dashboards/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronLeft, Sigma } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { FieldPickerContent } from '~/components/pickers/field-picker'
import { useResourceFields } from '~/components/resources'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { effectiveFieldTypeOf } from '../../lib/field-meta'
import {
  isAggregableFieldType,
  metricOpsForFieldType,
  metricTriggerLabel,
} from '../../lib/metric-ops'
import { sourceResourceId } from '../../lib/widget-source'

export function MetricField({
  source,
  metric,
  onChange,
}: {
  source: WidgetSource
  metric: Metric | undefined
  onChange: (metric: Metric) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ResourceField | null>(null)

  const resourceId = sourceResourceId(source)
  const { fields } = useResourceFields(resourceId)

  // Resolve the current metric's field for the trigger label.
  const currentField = useMemo(
    () =>
      metric?.fieldRef ? fields.find((f) => f.resourceFieldId === metric.fieldRef) : undefined,
    [fields, metric?.fieldRef]
  )
  const triggerLabel = metric
    ? metricTriggerLabel(
        metric.op,
        currentField ? effectiveFieldTypeOf(currentField) : undefined,
        currentField?.label
      )
    : undefined

  const reset = () => {
    setPending(null)
  }
  const close = () => {
    setOpen(false)
    reset()
  }

  const pickCountRecords = () => {
    onChange({ op: 'count' })
    close()
  }

  const pickOp = (op: Metric['op'], field: ResourceField) => {
    onChange({ op, fieldRef: field.resourceFieldId })
    close()
  }

  return (
    <FieldPanelRow title='Metric' isRequired>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}>
        <PopoverTrigger asChild>
          <PickerTrigger
            open={open}
            hasValue={!!metric}
            placeholder='Select a metric…'
            className='w-full ps-0 pe-1'>
            <span className='flex items-center gap-2'>
              <Sigma className='size-3.5 text-muted-foreground' />
              <span className='truncate text-sm'>{triggerLabel}</span>
            </span>
          </PickerTrigger>
        </PopoverTrigger>
        <PopoverContent className='w-64 p-0' align='start'>
          {pending ? (
            <OpStep field={pending} onBack={reset} onPick={pickOp} />
          ) : (
            <FieldPickerContent
              entityDefinitionId={resourceId}
              disableDrillDown
              closeOnSelect={false}
              onSelect={(_ref, field) => setPending(field)}
              filterField={(f) => isAggregableFieldType(effectiveFieldTypeOf(f))}
              searchPlaceholder='Search fields…'
              renderHeaderContent={(search) =>
                search ? null : (
                  <CommandGroup>
                    <CommandItem value='__count_records__' onSelect={pickCountRecords}>
                      <Sigma className='size-4 text-muted-foreground' />
                      <span>Count records</span>
                    </CommandItem>
                  </CommandGroup>
                )
              }
            />
          )}
        </PopoverContent>
      </Popover>
    </FieldPanelRow>
  )
}

function OpStep({
  field,
  onBack,
  onPick,
}: {
  field: ResourceField
  onBack: () => void
  onPick: (op: Metric['op'], field: ResourceField) => void
}) {
  const ft = effectiveFieldTypeOf(field)
  const ops = ft ? metricOpsForFieldType(ft) : []
  return (
    <Command>
      <div className='flex items-center gap-1.5 border-b px-2 py-1.5'>
        <button
          type='button'
          onClick={onBack}
          className='flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted'>
          <ChevronLeft className='size-3.5' />
        </button>
        <span className='truncate text-sm font-medium'>{field.label}</span>
      </div>
      <CommandList>
        <CommandGroup>
          {ops.map(({ op, label }) => (
            <CommandItem key={op} value={op} onSelect={() => onPick(op, field)}>
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
