// apps/web/src/components/evals/ui/tool-select.tsx
'use client'

import {
  Command,
  CommandEmpty,
  CommandIconItem,
  CommandInput,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Wrench } from 'lucide-react'
import { useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { PickerTrigger } from '~/components/ui/picker-trigger'

export interface ToolSelectOption {
  value: string
  label: string
  /** AppIcon iconId (lucide name, URL, or emoji); falls back to a wrench. */
  icon?: string
}

/** A tool's catalog icon, falling back to a generic wrench when unknown. */
function OptionIcon({ icon }: { icon?: string }) {
  if (!icon) return <Wrench className='size-4 text-muted-foreground' />
  return <AppIcon iconId={icon} size='sm' />
}

/**
 * Single-select tool picker for the eval assertion editor. The generic field
 * `SINGLE_SELECT` renders option icons through `EntityIcon` (lucide-only) and
 * drops them entirely in the closed trigger; this renders each tool's catalog
 * `AppIcon` — handling URL app avatars (e.g. Shopify) as well as lucide icons —
 * in both the dropdown and the trigger.
 */
export function ToolSelect({
  options,
  value,
  onChange,
  placeholder = 'Pick a tool',
}: {
  options: ToolSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          hasValue={!!selected}
          placeholder={placeholder}
          asCombobox
          className='ps-0 pe-1 w-full'>
          <OptionIcon icon={selected?.icon} />
          <span className='truncate text-sm'>{selected?.label}</span>
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent className='min-w-[var(--radix-popover-trigger-width)] p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search tools...' />
          <CommandList>
            <CommandEmpty>No tools found.</CommandEmpty>
            {options.map((o) => (
              <CommandIconItem
                key={o.value}
                // Search matches on both the human label and the tool name.
                value={`${o.label} ${o.value}`}
                icon={<OptionIcon icon={o.icon} />}
                label={o.label}
                onSelect={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
