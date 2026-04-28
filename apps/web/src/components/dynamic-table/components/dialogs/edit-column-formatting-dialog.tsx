// apps/web/src/components/dynamic-table/components/edit-column-formatting-dialog.tsx
'use client'

import type {
  BooleanFieldOptions,
  CurrencyFieldOptions,
  DateFieldOptions,
  NumberFieldOptions,
  PhoneFieldOptions,
} from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useEffect, useState } from 'react'
import {
  BooleanFormattingEditor,
  CurrencyFormattingEditor,
  DateFormattingEditor,
  DateTimeFormattingEditor,
  NumberFormattingEditor,
  PhoneFormattingEditor,
  TimeFormattingEditor,
} from '~/components/custom-fields/ui/formatting-editors'
import type {
  CheckboxColumnFormatting,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  FormattableFieldType,
  NumberColumnFormatting,
  PhoneColumnFormatting,
} from '../types'

/**
 * Convert NumberColumnFormatting to NumberFieldOptions
 */
function columnToNumberDisplayOptions(
  formatting: NumberColumnFormatting | null
): NumberFieldOptions {
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
 * Convert CurrencyColumnFormatting to CurrencyFieldOptions
 */
function columnToCurrencyDisplayOptions(
  formatting: CurrencyColumnFormatting | null,
  defaults?: Partial<CurrencyColumnFormatting>
): CurrencyFieldOptions {
  return {
    currencyCode: formatting?.currencyCode ?? defaults?.currencyCode ?? 'USD',
    decimals: formatting?.decimals ?? defaults?.decimals ?? 2,
    useGrouping: formatting?.useGrouping ?? defaults?.useGrouping ?? true,
    currencyDisplay: formatting?.currencyDisplay ?? defaults?.currencyDisplay ?? 'symbol',
  }
}

/**
 * Convert CurrencyFieldOptions to CurrencyColumnFormatting
 */
function currencyDisplayOptionsToColumn(opts: CurrencyFieldOptions): CurrencyColumnFormatting {
  return {
    type: 'currency',
    currencyCode: opts.currencyCode ?? 'USD',
    decimals: opts.decimals ?? 2,
    useGrouping: opts.useGrouping ?? true,
    currencyDisplay: opts.currencyDisplay ?? 'symbol',
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
function dateDisplayOptionsToColumn(
  opts: DateFieldOptions,
  includeTime?: boolean
): DateColumnFormatting {
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
function columnToCheckboxDisplayOptions(
  formatting: CheckboxColumnFormatting | null
): BooleanFieldOptions {
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
      <DialogContent size='md' position='tc'>
        <DialogHeader>
          <DialogTitle>Format Column</DialogTitle>
          <DialogDescription>Customize display formatting for "{columnLabel}"</DialogDescription>
        </DialogHeader>

        {fieldType === 'CURRENCY' && (
          <CurrencyFormattingEditor
            options={columnToCurrencyDisplayOptions(
              formatting as CurrencyColumnFormatting | null,
              defaultFormatting as Partial<CurrencyColumnFormatting>
            )}
            onChange={(opts) => setFormatting(currencyDisplayOptionsToColumn(opts))}
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
          <div className='flex w-full items-center justify-between'>
            <div>
              {currentFormatting && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-destructive border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30'
                  onClick={handleClear}>
                  Reset to default
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button size='sm' variant='ghost' onClick={() => onOpenChange(false)}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button onClick={handleSave} size='sm' variant='outline' data-dialog-submit>
                Save <KbdSubmit variant='outline' size='sm' />
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
