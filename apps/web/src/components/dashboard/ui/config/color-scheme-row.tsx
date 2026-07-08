// apps/web/src/components/dashboard/ui/config/color-scheme-row.tsx
'use client'

// The chart color-SCHEME picker (plan 12) — a bespoke `FieldPanelRow` dropdown
// that replaces the generic SINGLE_SELECT `ColorRow`. The generic FieldInputAdapter
// renders text/badge options only; this needs a per-option `SwatchStack`, so it's
// a dedicated `Popover` + searchable `Command` over `CHART_PALETTES`. The trigger
// shows the current scheme's label + its swatch stack; each menu item mirrors that.
// Used only here — if a second surface needs swatch-stack options, promote this.

import { type ChartPaletteId, normalizePaletteId } from '@auxx/lib/dashboards/client'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { CHART_PALETTES, previewSwatches } from '../../lib/chart-palettes'
import { SwatchStack } from './swatch-stack'

export function ColorRow({
  value,
  onChange,
}: {
  value: ChartPaletteId | string | undefined
  onChange: (value: ChartPaletteId) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = normalizePaletteId(value)
  const current = CHART_PALETTES.find((p) => p.id === selected) ?? CHART_PALETTES[0]

  return (
    <FieldPanelRow
      title='Color'
      description='Color scheme — one hue fans out into shades; “Default” uses distinct hues.'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <PickerTrigger open={open} hasValue className='w-full ps-0 pe-1'>
            <span className='flex flex-1 items-center justify-between gap-2'>
              <span className='truncate text-sm'>{current.label}</span>
              <SwatchStack colors={previewSwatches(current.id)} size={14} />
            </span>
          </PickerTrigger>
        </PopoverTrigger>
        <PopoverContent className='w-64 p-0' align='start'>
          <Command>
            <CommandInput placeholder='Search colors…' />
            <CommandList>
              <CommandEmpty>No colors found.</CommandEmpty>
              {CHART_PALETTES.map((palette) => (
                <CommandItem
                  key={palette.id}
                  value={palette.label}
                  onSelect={() => {
                    onChange(palette.id)
                    setOpen(false)
                  }}
                  className='gap-2'>
                  <span className='flex-1 truncate'>{palette.label}</span>
                  <SwatchStack colors={previewSwatches(palette.id)} size={14} />
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border border-blue-800 bg-info',
                      palette.id === selected ? 'opacity-100' : 'opacity-0'
                    )}>
                    <Check className='size-2.5! text-white' strokeWidth={4} />
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FieldPanelRow>
  )
}
