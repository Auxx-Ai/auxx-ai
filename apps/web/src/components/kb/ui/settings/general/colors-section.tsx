// apps/web/src/components/kb/ui/settings/general/colors-section.tsx
'use client'

import { FormField } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { GeneralFormValues } from './general-schema'

const HEX_PATTERN = /^#([0-9A-F]{3}){1,2}$/i

const COLOR_PALETTE = [
  '#0ea5e9',
  '#3b82f6',
  '#2563eb',
  '#1d4ed8',
  '#1e40af',
  '#8b5cf6',
  '#7c3aed',
  '#6d28d9',
  '#5b21b6',
  '#4c1d95',
  '#ec4899',
  '#db2777',
  '#be185d',
  '#9d174d',
  '#831843',
  '#ef4444',
  '#dc2626',
  '#b91c1c',
  '#991b1b',
  '#7f1d1d',
  '#f97316',
  '#ea580c',
  '#c2410c',
  '#9a3412',
  '#7c2d12',
  '#eab308',
  '#ca8a04',
  '#a16207',
  '#854d0e',
  '#713f12',
  '#22c55e',
  '#16a34a',
  '#15803d',
  '#166534',
  '#14532d',
  '#14b8a6',
  '#0d9488',
  '#0f766e',
  '#115e59',
  '#134e4a',
  '#6b7280',
  '#4b5563',
  '#374151',
  '#1f2937',
  '#111827',
]

interface ColorFieldProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

function ColorField({ value, onChange, disabled, placeholder = 'Pick a color' }: ColorFieldProps) {
  const [open, setOpen] = useState(false)
  const [customColor, setCustomColor] = useState(value)

  useEffect(() => {
    setCustomColor(value)
  }, [value])

  const handleSelect = (color: string) => {
    onChange(color)
    setCustomColor(color)
    setOpen(false)
  }

  const applyCustom = () => {
    if (HEX_PATTERN.test(customColor)) {
      onChange(customColor)
    } else {
      setCustomColor(value)
    }
  }

  const hasValue = !!value && HEX_PATTERN.test(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant='transparent'
          hasValue={hasValue}
          placeholder={placeholder}
          showClear={false}
          asCombobox
          className='ps-0 pe-1 w-full'>
          <div className='flex items-center gap-2'>
            <span
              className='size-4 rounded border'
              style={{ backgroundColor: hasValue ? value : 'transparent' }}
            />
            <span className='text-sm font-mono'>{value || ''}</span>
          </div>
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent className='w-64 p-3' align='start'>
        <div className='space-y-3'>
          <div className='flex items-center'>
            <div
              className='mr-3 size-10 rounded border'
              style={{ backgroundColor: HEX_PATTERN.test(customColor) ? customColor : value }}
            />
            <div>
              <Label htmlFor='custom-color'>Custom color</Label>
              <Input
                id='custom-color'
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyCustom()
                    setOpen(false)
                  }
                }}
                className='mt-1 h-8'
                maxLength={7}
              />
            </div>
          </div>

          <div>
            <Label className='mb-2 block text-xs text-muted-foreground'>Predefined</Label>
            <div className='grid grid-cols-5 gap-2'>
              {COLOR_PALETTE.map((color) => (
                <button
                  type='button'
                  key={color}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border transition-all',
                    'focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-background'
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => handleSelect(color)}>
                  {value.toLowerCase() === color.toLowerCase() && (
                    <Check className='size-4 text-white' />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ColorsSectionProps {
  form: UseFormReturn<GeneralFormValues>
  isPending: boolean
}

const colorRows = [
  { key: 'primary', label: 'Primary', description: 'Main elements such as buttons and links' },
  { key: 'tint', label: 'Tint', description: 'Background and secondary elements' },
  { key: 'info', label: 'Info', description: 'Informational badges and notices' },
  { key: 'success', label: 'Success', description: 'Successful state indicators' },
  { key: 'warning', label: 'Warning', description: 'Warning state indicators' },
  { key: 'danger', label: 'Danger', description: 'Errors and destructive actions' },
] as const

interface ColorPaletteFieldsProps {
  form: UseFormReturn<GeneralFormValues>
  isPending: boolean
  mode: 'light' | 'dark'
}

function ColorPaletteFields({ form, isPending, mode }: ColorPaletteFieldsProps) {
  const suffix = mode === 'light' ? 'Light' : 'Dark'

  return (
    <VarEditorField orientation='responsive' className='p-0'>
      {colorRows.map((row) => {
        const fieldName = `${row.key}Color${suffix}` as keyof GeneralFormValues
        return (
          <FormField
            key={fieldName}
            control={form.control}
            name={fieldName}
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title={row.label}
                description={row.description}
                type={BaseType.STRING}
                showIcon
                validationError={fieldState.error?.message}>
                <ColorField
                  value={(field.value as string) || ''}
                  onChange={field.onChange}
                  disabled={isPending}
                  placeholder='Pick a color'
                />
              </VarEditorFieldRow>
            )}
          />
        )
      })}
    </VarEditorField>
  )
}

export function ColorsSection({ form, isPending }: ColorsSectionProps) {
  const [mode, setMode] = useState<'light' | 'dark'>('light')

  return (
    <Section
      title='Colors'
      description='Pick brand and semantic colours for each mode.'
      actions={
        <RadioTab size='sm' value={mode} onValueChange={(v) => setMode(v as 'light' | 'dark')}>
          <RadioTabItem value='light'>Light</RadioTabItem>
          <RadioTabItem value='dark'>Dark</RadioTabItem>
        </RadioTab>
      }>
      <ColorPaletteFields form={form} isPending={isPending} mode={mode} />
    </Section>
  )
}
