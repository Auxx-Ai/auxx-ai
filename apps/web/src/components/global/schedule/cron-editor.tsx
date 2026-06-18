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
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Textarea } from '@auxx/ui/components/textarea'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertCircle,
  BookOpenText,
  Check,
  Clipboard,
  ClipboardCheck,
  Clock,
  Lightbulb,
  MessageCircleQuestion,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { validateCronExpression } from './cron-validation'

interface CronEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

/** Small icon button for the editor's header operations. */
const ActionButton: React.FC<{
  onClick?: () => void
  children: React.ReactNode
  className?: string
}> = ({ onClick, children, className }) => (
  <button
    type='button'
    onClick={onClick}
    className={cn(
      'flex size-6 items-center justify-center rounded hover:bg-primary-150',
      className
    )}>
    {children}
  </button>
)

const writeClipboard = (text: string) => {
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(text)
  }
}

interface ValidationResultProps {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

/** Valid/invalid status icon with a tooltip listing field-level errors + warnings. */
const ValidationResult: React.FC<ValidationResultProps> = ({ isValid, errors, warnings }) => {
  const tooltipContent = isValid ? (
    <div className='text-xs'>
      <span>Valid cron expression</span>
      {warnings.length > 0 && (
        <div className='mt-1 space-y-1'>
          {warnings.map((warning, index) => (
            <div key={index} className='flex items-center gap-1 text-yellow-600'>
              <Lightbulb className='h-3 w-3' />
              {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className='space-y-1 text-xs'>
      <span className='text-red-600'>Invalid cron expression:</span>
      {errors.map((error, index) => (
        <div key={index} className='text-red-600'>
          • {error}
        </div>
      ))}
      {warnings.map((warning, index) => (
        <div key={index} className='flex items-center gap-1 text-yellow-600'>
          <Lightbulb className='h-3 w-3' />
          {warning}
        </div>
      ))}
    </div>
  )

  return (
    <Tooltip contentComponent={tooltipContent}>
      <ActionButton className={cn(isValid ? 'text-good-400' : 'text-bad-400 hover:bg-bad-50')}>
        {isValid ? <Check className='size-4' /> : <AlertCircle className='size-4' />}
      </ActionButton>
    </Tooltip>
  )
}

// Common cron presets. Sub-5-minute cadences are omitted to match the
// MIN_SCHEDULE_INTERVAL_MINUTES floor enforced in the scheduler.
const PRESETS: { label: string; value: string; description: string }[] = [
  { label: 'Every 5 minutes', value: '*/5 * * * *', description: 'Runs every 5 minutes' },
  { label: 'Every 15 minutes', value: '*/15 * * * *', description: 'Runs every 15 minutes' },
  { label: 'Every 30 minutes', value: '*/30 * * * *', description: 'Runs every 30 minutes' },
  { label: 'Every hour', value: '0 * * * *', description: 'Runs at the start of every hour' },
  { label: 'Every 2 hours', value: '0 */2 * * *', description: 'Runs every 2 hours' },
  { label: 'Every 6 hours', value: '0 */6 * * *', description: 'Runs every 6 hours' },
  { label: 'Every 12 hours', value: '0 */12 * * *', description: 'Runs every 12 hours' },
  { label: 'Daily at midnight', value: '0 0 * * *', description: 'Runs daily at 12:00 AM' },
  { label: 'Daily at 9 AM', value: '0 9 * * *', description: 'Runs daily at 9:00 AM' },
  { label: 'Daily at 6 PM', value: '0 18 * * *', description: 'Runs daily at 6:00 PM' },
  { label: 'Weekdays at 9 AM', value: '0 9 * * 1-5', description: 'Runs Monday–Friday at 9:00 AM' },
  {
    label: 'Weekends at 10 AM',
    value: '0 10 * * 0,6',
    description: 'Runs Saturday and Sunday at 10:00 AM',
  },
  { label: 'Weekly on Monday', value: '0 9 * * 1', description: 'Runs every Monday at 9:00 AM' },
  {
    label: 'Monthly on 1st',
    value: '0 9 1 * *',
    description: 'Runs on the 1st of every month at 9:00 AM',
  },
  {
    label: 'Quarterly',
    value: '0 9 1 */3 *',
    description: 'Runs every 3 months on the 1st at 9:00 AM',
  },
]

/** Searchable presets popover. */
const PresetSelector: React.FC<{ onSelectPreset: (value: string) => void }> = ({
  onSelectPreset,
}) => {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <ActionButton>
            <BookOpenText className='size-4' />
          </ActionButton>
        </div>
      </PopoverTrigger>
      <PopoverContent className='w-80 p-0' align='end'>
        <Command>
          <CommandInput placeholder='Search presets...' />
          <CommandList>
            <CommandEmpty>No presets found.</CommandEmpty>
            <CommandGroup heading='Common presets'>
              {PRESETS.map((preset) => (
                <Tooltip key={preset.value} content={preset.description} side='right'>
                  <CommandItem
                    value={`${preset.label} ${preset.description}`}
                    onSelect={() => {
                      onSelectPreset(preset.value)
                      setOpen(false)
                    }}>
                    <div className='flex flex-1 items-center gap-2'>
                      <span className='text-sm font-medium'>{preset.label}</span>
                      <code className='font-mono text-xs text-muted-foreground'>
                        {preset.value}
                      </code>
                    </div>
                  </CommandItem>
                </Tooltip>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Cron-format help popover (field ranges, special characters, examples). */
const CronFormatHelp: React.FC = () => {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <ActionButton>
            <MessageCircleQuestion className='size-4' />
          </ActionButton>
        </div>
      </PopoverTrigger>
      <PopoverContent className='w-96 p-4' align='end'>
        <div className='space-y-4'>
          <div className='flex items-center gap-2'>
            <Clock className='h-4 w-4' />
            <h3 className='text-sm font-semibold'>Cron format</h3>
          </div>

          <div className='text-xs text-muted-foreground'>
            Fields: minute (0-59) | hour (0-23) | day (1-31) | month (1-12) | weekday (0-7)
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <p className='mb-2 text-sm font-medium'>Special characters:</p>
              <ul className='space-y-1 text-xs text-muted-foreground'>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>*</code>
                  <span>Any value</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>,</code>
                  <span>Multiple values</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>-</code>
                  <span>Range of values</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>/</code>
                  <span>Step values</span>
                </li>
              </ul>
            </div>
            <div>
              <p className='mb-2 text-sm font-medium'>Examples:</p>
              <ul className='space-y-1 text-xs text-muted-foreground'>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>*/15</code>
                  <span>Every 15 units</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>1-5</code>
                  <span>Range 1 to 5</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>1,3,5</code>
                  <span>Values 1, 3, and 5</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='rounded bg-muted px-1 py-0.5 text-xs'>*/2</code>
                  <span>Every 2nd value</span>
                </li>
              </ul>
            </div>
          </div>

          <div className='border-t pt-2'>
            <p className='mb-2 text-sm font-medium'>Common examples:</p>
            <div className='space-y-2 text-xs'>
              <div className='flex justify-between'>
                <code className='rounded bg-muted px-2 py-1'>0 * * * *</code>
                <span className='text-muted-foreground'>Every hour</span>
              </div>
              <div className='flex justify-between'>
                <code className='rounded bg-muted px-2 py-1'>0 9 * * 1-5</code>
                <span className='text-muted-foreground'>Weekdays at 9 AM</span>
              </div>
              <div className='flex justify-between'>
                <code className='rounded bg-muted px-2 py-1'>*/30 * * * *</code>
                <span className='text-muted-foreground'>Every 30 minutes</span>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Advanced cron expression editor — live per-field validation, a searchable
 * presets popover, format help, and copy-to-clipboard. Standalone (no workflow
 * dependencies), so it is shared by the {@link ScheduleEditor} (data connectors,
 * agent triggers) and the workflow scheduled-trigger panel.
 */
export const CronEditor: React.FC<CronEditorProps> = ({
  value,
  onChange,
  disabled,
  placeholder = '0 * * * * (every hour)',
}) => {
  const [localValue, setLocalValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  // Debounce the parent onChange to prevent lag while typing.
  const debouncedOnChange = useDebouncedCallback(onChange, 300)
  const validation = validateCronExpression(localValue)

  const handleCopy = useCallback(() => {
    writeClipboard(localValue)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }, [localValue])

  // Sync external value changes.
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (next: string) => {
    setLocalValue(next)
    debouncedOnChange(next)
  }

  const handlePreset = (next: string) => {
    setLocalValue(next)
    onChange(next) // presets apply immediately for better UX
  }

  return (
    <div
      className={cn(
        'w-full rounded-[9px] from-[#0ba5ec] to-[#155aef] bg-transparent p-0.5 focus-within:bg-linear-to-r'
      )}>
      <div className='overflow-hidden rounded-lg border bg-primary-100 focus-within:bg-background'>
        <div className='flex h-7 items-center justify-between px-2 pt-1'>
          <div className='text-xs font-semibold uppercase text-primary-500'>Cron</div>
          <div className='flex items-center'>
            <Tooltip content={isCopied ? 'Copied!' : 'Copy expression'}>
              <ActionButton onClick={handleCopy}>
                {isCopied ? (
                  <ClipboardCheck className='size-4' />
                ) : (
                  <Clipboard className='size-4' />
                )}
              </ActionButton>
            </Tooltip>
            <Tooltip content='Cron format help'>
              <CronFormatHelp />
            </Tooltip>
            <Tooltip content='Presets'>
              <PresetSelector onSelectPreset={handlePreset} />
            </Tooltip>
            <ValidationResult
              isValid={validation.isValid}
              errors={validation.errors}
              warnings={validation.warnings}
            />
          </div>
        </div>
        <div className='px-2 pb-4'>
          <div className='relative'>
            <Textarea
              id='cron-expression'
              value={localValue}
              onChange={(e) => handleChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={disabled}
              className='h-[20px] min-h-0 resize-none border-0 bg-transparent px-2 py-0 font-mono text-sm shadow-none focus-visible:outline-none focus-visible:ring-0'
              rows={2}
            />
            {!localValue && !isFocused && placeholder && (
              <div className='pointer-events-none absolute left-[10px] top-0 text-[13px] font-normal leading-[18px] text-gray-300'>
                {placeholder}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
