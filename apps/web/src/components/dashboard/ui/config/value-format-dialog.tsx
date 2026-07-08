// apps/web/src/components/dashboard/ui/config/value-format-dialog.tsx
'use client'

// Per-widget metric VALUE format override (plan 10). Reuses the shared
// Number/Currency formatting editors (`custom-fields/ui/formatting-editors`) —
// the SAME controls fields use everywhere — and stores their `FieldOptions`
// output directly on `config.valueFormat`, which `useMetricFieldMeta` merges
// over the field's native options. No `ColumnFormatting` round-trip: the editors
// already speak `FieldOptions`, which is exactly what `formatMetricValue` reads.
//
// The editor shown follows the metric field's own type: CURRENCY → currency
// editor, everything numeric (incl. count/no-field metrics) → number editor.
// Percent ops and date-typed values have no meaningful numeric override, so the
// row hides itself.

import type { Metric } from '@auxx/lib/dashboards/client'
import type {
  CurrencyFieldOptions,
  FieldOptions,
  NumberFieldOptions,
} from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { useState } from 'react'
import {
  CurrencyFormattingEditor,
  NumberFormattingEditor,
} from '~/components/custom-fields/ui/formatting-editors'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { useMetricFieldMeta } from '../../hooks/use-metric-field'

/** Which editor (if any) fits a metric's value. `null` ⇒ no override control. */
function editorKindForMetric(metric: Metric, fieldType?: string): 'currency' | 'number' | null {
  if (metric.op.startsWith('percent')) return null
  if (fieldType === 'CURRENCY') return 'currency'
  if (fieldType === 'DATE' || fieldType === 'DATETIME') return null
  // NUMBER, CALC→number, or a field-less count metric → generic number options.
  return 'number'
}

export function ValueFormatRow({
  metric,
  value,
  onChange,
}: {
  metric: Metric
  value: FieldOptions | undefined
  onChange: (value: FieldOptions | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  // Resolve the native field type (no override) to pick the right editor.
  const meta = useMetricFieldMeta(metric)
  const kind = editorKindForMetric(metric, meta.fieldType)
  if (!kind) return null

  return (
    <FieldPanelRow
      title='Value format'
      description='How the number is displayed — decimals, currency, percentage, or compact (1.2k).'>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <PickerTrigger hasValue={!!value} placeholder='Default' className='w-full ps-0 pe-1'>
            <span className='truncate text-sm'>{value ? 'Custom' : 'Default'}</span>
          </PickerTrigger>
        </DialogTrigger>
        <ValueFormatDialogBody
          kind={kind}
          value={value}
          onClose={() => setOpen(false)}
          onChange={onChange}
        />
      </Dialog>
    </FieldPanelRow>
  )
}

function ValueFormatDialogBody({
  kind,
  value,
  onClose,
  onChange,
}: {
  kind: 'currency' | 'number'
  value: FieldOptions | undefined
  onClose: () => void
  onChange: (value: FieldOptions | undefined) => void
}) {
  // Local draft so Cancel discards; Save commits, Reset clears the override.
  const [draft, setDraft] = useState<FieldOptions>(value ?? {})

  const save = () => {
    onChange(draft)
    onClose()
  }
  const reset = () => {
    onChange(undefined)
    onClose()
  }

  return (
    <DialogContent size='sm' position='tc'>
      <DialogHeader>
        <DialogTitle>Value format</DialogTitle>
        <DialogDescription>Customize how this widget displays its value.</DialogDescription>
      </DialogHeader>

      {kind === 'currency' ? (
        <CurrencyFormattingEditor
          options={draft as CurrencyFieldOptions}
          onChange={(opts) => setDraft(opts)}
        />
      ) : (
        <NumberFormattingEditor
          options={draft as NumberFieldOptions}
          onChange={(opts) => setDraft(opts)}
        />
      )}

      <DialogFooter>
        <div className='flex w-full items-center justify-between'>
          <div>
            {value && (
              <Button
                size='sm'
                variant='ghost'
                className='border text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive'
                onClick={reset}>
                Reset to default
              </Button>
            )}
          </div>
          <div className='flex gap-2'>
            <Button size='sm' variant='ghost' onClick={onClose}>
              Cancel
            </Button>
            <Button size='sm' variant='outline' onClick={save} data-dialog-submit>
              Save
            </Button>
          </div>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}
