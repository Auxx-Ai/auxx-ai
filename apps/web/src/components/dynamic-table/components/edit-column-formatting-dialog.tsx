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
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'
import { CurrencyPicker } from '~/components/pickers/currency-picker'
import type {
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  NumberColumnFormatting,
  FormattableFieldType,
} from '../types'

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
        {(fieldType === 'DATE' || fieldType === 'DATETIME' || fieldType === 'TIME') && (
          <DateFormattingEditor
            formatting={formatting as DateColumnFormatting | null}
            onChange={(f) => setFormatting(f)}
          />
        )}
        {fieldType === 'NUMBER' && (
          <NumberFormattingEditor
            formatting={formatting as NumberColumnFormatting | null}
            onChange={(f) => setFormatting(f)}
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
                Cancel
              </Button>
              <Button onClick={handleSave} size="sm" variant="outline">
                Save
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

/** Props for DateFormattingEditor */
interface DateFormattingEditorProps {
  formatting: DateColumnFormatting | null
  onChange: (f: DateColumnFormatting) => void
}

/**
 * Date formatting sub-editor
 */
function DateFormattingEditor({ formatting, onChange }: DateFormattingEditorProps) {
  const current: DateColumnFormatting = {
    type: 'date',
    format: formatting?.format ?? 'medium',
    includeTime: formatting?.includeTime ?? false,
  }

  return (
    <div className="rounded-xl    space-y-4">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel>Date Format</FieldLabel>
          <Select
            value={current.format}
            onValueChange={(v) =>
              onChange({ ...current, format: v as DateColumnFormatting['format'] })
            }>
            <SelectTrigger>
              <SelectValue placeholder="Select date format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short (12/1/24)</SelectItem>
              <SelectItem value="medium">Medium (Dec 1, 2024)</SelectItem>
              <SelectItem value="long">Long (December 1, 2024)</SelectItem>
              <SelectItem value="relative">Relative (2 days ago)</SelectItem>
              <SelectItem value="iso">ISO (2024-12-01)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Include Time</FieldLabel>
          <Select
            value={current.includeTime ? 'yes' : 'no'}
            onValueChange={(v) => onChange({ ...current, includeTime: v === 'yes' })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no">Date only</SelectItem>
              <SelectItem value="yes">Date and time</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </div>
  )
}

/** Props for NumberFormattingEditor */
interface NumberFormattingEditorProps {
  formatting: NumberColumnFormatting | null
  onChange: (f: NumberColumnFormatting) => void
}

/**
 * Number formatting sub-editor
 */
function NumberFormattingEditor({ formatting, onChange }: NumberFormattingEditorProps) {
  const current: NumberColumnFormatting = {
    type: 'number',
    decimalPlaces: formatting?.decimalPlaces ?? 2,
    useGrouping: formatting?.useGrouping ?? true,
    displayAs: formatting?.displayAs ?? 'number',
    prefix: formatting?.prefix ?? '',
    suffix: formatting?.suffix ?? '',
  }

  return (
    <div className=" space-y-4">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel>Decimal Places</FieldLabel>
          <Select
            value={String(current.decimalPlaces)}
            onValueChange={(v) => onChange({ ...current, decimalPlaces: parseInt(v, 10) })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0 (1234)</SelectItem>
              <SelectItem value="1">1 (1234.5)</SelectItem>
              <SelectItem value="2">2 (1234.56)</SelectItem>
              <SelectItem value="3">3 (1234.567)</SelectItem>
              <SelectItem value="4">4 (1234.5678)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Thousand Separators</FieldLabel>
          <Select
            value={current.useGrouping ? 'yes' : 'no'}
            onValueChange={(v) => onChange({ ...current, useGrouping: v === 'yes' })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">With separators (1,234.56)</SelectItem>
              <SelectItem value="no">No separators (1234.56)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Display As</FieldLabel>
          <Select
            value={current.displayAs}
            onValueChange={(v) =>
              onChange({ ...current, displayAs: v as NumberColumnFormatting['displayAs'] })
            }>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="number">Number (1234.56)</SelectItem>
              <SelectItem value="percentage">Percentage (12.35%)</SelectItem>
              <SelectItem value="compact">Compact (1.2K)</SelectItem>
              <SelectItem value="bytes">Bytes (1.21 KB)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </div>
  )
}
