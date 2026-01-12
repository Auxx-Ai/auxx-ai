// apps/web/src/components/dynamic-table/components/edit-column-formatting-dialog.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { CurrencyPicker } from '~/components/pickers/currency-picker'
import {
  NumberFormattingEditor,
  DateFormattingEditor,
  DateTimeFormattingEditor,
  TimeFormattingEditor,
  PhoneFormattingEditor,
  BooleanFormattingEditor,
} from '~/components/custom-fields/ui/formatting-editors'
import type {
  NumberFieldOptions,
  DateFieldOptions,
  PhoneFieldOptions,
  BooleanFieldOptions,
} from '@auxx/lib/field-values/client'
import type {
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  NumberColumnFormatting,
  PhoneColumnFormatting,
  CheckboxColumnFormatting,
  FormattableFieldType,
} from '../types'

/**
 * Convert NumberColumnFormatting to NumberFieldOptions
 */
function columnToNumberDisplayOptions(formatting: NumberColumnFormatting | null): NumberFieldOptions {
  return {
    decimals: formatting?.decimalPlaces ?? 2,
    useGrouping: formatting?.useGrouping ?? true,
    displayAs: formatting?.displayAs ?? 'number',
    prefix: formatting?.prefix ?? '',
    suffix: formatting?.suffix ?? '',
  }
}

/**
 * Convert NumberFieldOptions to NumberColumnFormatting
 */
function numberDisplayOptionsToColumn(opts: NumberFieldOptions): NumberColumnFormatting {
  return {
    type: 'number',
    decimalPlaces: opts.decimals ?? 2,
    useGrouping: opts.useGrouping ?? true,
    displayAs: opts.displayAs ?? 'number',
    prefix: opts.prefix ?? '',
    suffix: opts.suffix ?? '',
  }
}

/**
 * Convert DateColumnFormatting to DateFieldOptions
 */
function columnToDateDisplayOptions(formatting: DateColumnFormatting | null): DateFieldOptions {
  return {
    format: formatting?.format ?? 'medium',
    includeTime: formatting?.includeTime ?? false,
    timeFormat: (formatting as DateFieldOptions)?.timeFormat ?? '12h',
  }
}

/**
 * Convert DateFieldOptions to DateColumnFormatting
 */
function dateDisplayOptionsToColumn(opts: DateFieldOptions, includeTime?: boolean): DateColumnFormatting {
  return {
    type: 'date',
    format: opts.format ?? 'medium',
    includeTime: includeTime ?? opts.includeTime ?? false,
  }
}

/**
 * Convert PhoneColumnFormatting to PhoneFieldOptions
 */
function columnToPhoneDisplayOptions(formatting: PhoneColumnFormatting | null): PhoneFieldOptions {
  return {
    phoneFormat: formatting?.phoneFormat ?? 'national',
  }
}

/**
 * Convert PhoneFieldOptions to PhoneColumnFormatting
 */
function phoneDisplayOptionsToColumn(opts: PhoneFieldOptions): PhoneColumnFormatting {
  return {
    type: 'phone',
    phoneFormat: opts.phoneFormat ?? 'national',
  }
}

/**
 * Convert CheckboxColumnFormatting to BooleanFieldOptions
 */
function columnToCheckboxDisplayOptions(formatting: CheckboxColumnFormatting | null): BooleanFieldOptions {
  return {
    checkboxStyle: formatting?.checkboxStyle ?? 'icon-text',
    trueLabel: formatting?.trueLabel ?? 'True',
    falseLabel: formatting?.falseLabel ?? 'False',
  }
}

/**
 * Convert BooleanFieldOptions to CheckboxColumnFormatting
 */
function checkboxDisplayOptionsToColumn(opts: BooleanFieldOptions): CheckboxColumnFormatting {
  return {
    type: 'checkbox',
    checkboxStyle: opts.checkboxStyle ?? 'icon-text',
    trueLabel: opts.trueLabel ?? 'True',
    falseLabel: opts.falseLabel ?? 'False',
  }
}

/** Props for EditColumnFormattingDialog component */
interface EditColumnFormattingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  columnId: string
  columnLabel: string
  fieldType: FormattableFieldType
  currentFormatting: ColumnFormatting | undefined
  defaultFormatting?: Partial<ColumnFormatting>
  onSave: (formatting: ColumnFormatting | null) => void
}

/**
 * Dialog for editing column display formatting
 */
export function EditColumnFormattingDialog({
  open,
  onOpenChange,
  columnId,
  columnLabel,
  fieldType,
  currentFormatting,
  defaultFormatting,
  onSave,
}: EditColumnFormattingDialogProps) {
  const [formatting, setFormatting] = useState<ColumnFormatting | null>(null)

  useEffect(() => {
    if (open) {
      setFormatting(currentFormatting ?? null)
    }
  }, [open, currentFormatting])

  /**
   * Handle save action
   */
  const handleSave = () => {
    onSave(formatting)
    onOpenChange(false)
  }

  /**
   * Handle reset to default
   */
  const handleClear = () => {
    onSave(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" position="tc">
        <DialogHeader>
          <DialogTitle>Format Column</DialogTitle>
          <DialogDescription>Customize display formatting for "{columnLabel}"</DialogDescription>
        </DialogHeader>

        {fieldType === 'CURRENCY' && (
          <CurrencyFormattingEditor
            formatting={formatting as CurrencyColumnFormatting | null}
            defaultFormatting={defaultFormatting as Partial<CurrencyColumnFormatting>}
            onChange={(f) => setFormatting(f)}
          />
        )}
        {fieldType === 'DATE' && (
          <DateFormattingEditor
            options={columnToDateDisplayOptions(formatting as DateColumnFormatting | null)}
            onChange={(opts) => setFormatting(dateDisplayOptionsToColumn(opts))}
          />
        )}
        {fieldType === 'DATETIME' && (
          <DateTimeFormattingEditor
            options={columnToDateDisplayOptions(formatting as DateColumnFormatting | null)}
            onChange={(opts) => setFormatting(dateDisplayOptionsToColumn(opts, true))}
          />
        )}
        {fieldType === 'TIME' && (
          <TimeFormattingEditor
            options={columnToDateDisplayOptions(formatting as DateColumnFormatting | null)}
            onChange={(opts) => setFormatting(dateDisplayOptionsToColumn(opts))}
          />
        )}
        {fieldType === 'NUMBER' && (
          <NumberFormattingEditor
            options={columnToNumberDisplayOptions(formatting as NumberColumnFormatting | null)}
            onChange={(opts) => setFormatting(numberDisplayOptionsToColumn(opts))}
          />
        )}
        {fieldType === 'PHONE_INTL' && (
          <PhoneFormattingEditor
            options={columnToPhoneDisplayOptions(formatting as PhoneColumnFormatting | null)}
            onChange={(opts) => setFormatting(phoneDisplayOptionsToColumn(opts))}
          />
        )}
        {fieldType === 'CHECKBOX' && (
          <BooleanFormattingEditor
            options={columnToCheckboxDisplayOptions(formatting as CheckboxColumnFormatting | null)}
            onChange={(opts) => setFormatting(checkboxDisplayOptionsToColumn(opts))}
          />
        )}

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <div>
              {currentFormatting && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                  onClick={handleClear}>
                  Reset to default
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
              </Button>
              <Button onClick={handleSave} size="sm" variant="outline" data-dialog-submit>
                Save <KbdSubmit variant="outline" size="sm" />
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Props for CurrencyFormattingEditor */
interface CurrencyFormattingEditorProps {
  formatting: CurrencyColumnFormatting | null
  defaultFormatting?: Partial<CurrencyColumnFormatting>
  onChange: (f: CurrencyColumnFormatting) => void
}

/**
 * Currency formatting sub-editor
 */
function CurrencyFormattingEditor({
  formatting,
  defaultFormatting,
  onChange,
}: CurrencyFormattingEditorProps) {
  const current: CurrencyColumnFormatting = {
    type: 'currency',
    currencyCode: formatting?.currencyCode ?? defaultFormatting?.currencyCode ?? 'USD',
    decimalPlaces: formatting?.decimalPlaces ?? defaultFormatting?.decimalPlaces ?? 'two-places',
    displayType: formatting?.displayType ?? defaultFormatting?.displayType ?? 'symbol',
    groups: formatting?.groups ?? defaultFormatting?.groups ?? 'default',
  }

  /**
   * Update a specific field in the formatting object
   */
  const update = (key: keyof CurrencyColumnFormatting, value: string) => {
    onChange({ ...current, [key]: value })
  }

  return (
    <div className="">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel>Currency</FieldLabel>
          <CurrencyPicker
            selected={current.currencyCode ?? 'USD'}
            onChange={(code) => update('currencyCode', code)}
          />
        </Field>

        <Field>
          <FieldLabel>Decimal Places</FieldLabel>
          <Select value={current.decimalPlaces} onValueChange={(v) => update('decimalPlaces', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select decimal format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="two-places">Two decimal places (10.99)</SelectItem>
              <SelectItem value="no-decimal">No decimals (11)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Currency Display</FieldLabel>
          <Select value={current.displayType} onValueChange={(v) => update('displayType', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select display format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="symbol">Symbol ($10.99)</SelectItem>
              <SelectItem value="code">Code (USD 10.99)</SelectItem>
              <SelectItem value="name">Name (10.99 US dollars)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Thousand Separators</FieldLabel>
          <Select value={current.groups} onValueChange={(v) => update('groups', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select grouping" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">With separators (1,000.00)</SelectItem>
              <SelectItem value="no-groups">No separators (1000.00)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </div>
  )
}

