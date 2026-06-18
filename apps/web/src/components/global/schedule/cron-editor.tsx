// apps/web/src/components/global/schedule/cron-editor.tsx
'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { BookOpenText } from 'lucide-react'
import { useState } from 'react'

interface CronEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const PRESETS: { label: string; value: string; description: string }[] = [
  { label: 'Every minute', value: '* * * * *', description: 'Runs every minute' },
  { label: 'Every 5 minutes', value: '*/5 * * * *', description: 'Runs every 5 minutes' },
  { label: 'Every 15 minutes', value: '*/15 * * * *', description: 'Runs every 15 minutes' },
  { label: 'Every 30 minutes', value: '*/30 * * * *', description: 'Runs every 30 minutes' },
  { label: 'Every hour', value: '0 * * * *', description: 'Top of every hour' },
  { label: 'Every 6 hours', value: '0 */6 * * *', description: 'Every 6 hours' },
  { label: 'Daily at midnight', value: '0 0 * * *', description: 'Runs daily at 12:00 AM' },
  { label: 'Daily at 9 AM', value: '0 9 * * *', description: 'Runs daily at 9:00 AM' },
  { label: 'Weekdays at 9 AM', value: '0 9 * * 1-5', description: 'Mon–Fri at 9:00 AM' },
  { label: 'Weekly on Monday', value: '0 9 * * 1', description: 'Mondays at 9:00 AM' },
  { label: 'Monthly on 1st', value: '0 9 1 * *', description: '1st of each month at 9:00 AM' },
]

/**
 * Standalone cron expression input with a presets popover. No workflow
 * dependencies — safe to use in dialogs.
 */
export function CronEditor({
  value,
  onChange,
  placeholder = '0 * * * * (every hour)',
}: CronEditorProps) {
  const [presetsOpen, setPresetsOpen] = useState(false)

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <Label>Cron expression</Label>
        <Popover open={presetsOpen} onOpenChange={setPresetsOpen}>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                'text-muted-foreground hover:bg-muted'
              )}>
              <BookOpenText className='size-3.5' />
              Presets
            </button>
          </PopoverTrigger>
          <PopoverContent className='w-80 p-0' align='end'>
            <Command>
              <CommandInput placeholder='Search presets...' />
              <CommandList>
                <CommandEmpty>No presets found.</CommandEmpty>
                <CommandGroup heading='Common presets'>
                  {PRESETS.map((preset) => (
                    <CommandItem
                      key={preset.value}
                      value={`${preset.label} ${preset.description}`}
                      onSelect={() => {
                        onChange(preset.value)
                        setPresetsOpen(false)
                      }}>
                      <div className='flex-1'>
                        <div className='text-sm font-medium'>{preset.label}</div>
                        <div className='font-mono text-xs text-muted-foreground'>
                          {preset.value}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className='font-mono text-sm'
      />
      <p className='text-xs text-muted-foreground'>Fields: minute · hour · day · month · weekday</p>
    </div>
  )
}
