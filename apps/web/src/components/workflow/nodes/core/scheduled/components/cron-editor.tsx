// apps/web/src/components/workflow/nodes/core/scheduled-trigger/components/cron-editor.tsx

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
import { toastSuccess } from '@auxx/ui/components/toast'
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
import { ActionButton } from '~/components/workflow/ui/action-button'
import { copy } from '~/components/workflow/utils/copy'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import type { ScheduledTriggerUIConfig } from '../types'
import { validateScheduledTriggerConfig } from '../validation'

interface CronEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  config: ScheduledTriggerUIConfig
  placeholder?: string
}

interface ValidationResultProps {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validation result component showing cron validation status
 */
const ValidationResult: React.FC<ValidationResultProps> = ({ isValid, errors, warnings }) => {
  const getTooltipContent = () => {
    if (isValid) {
      return (
        <div className='text-xs'>
          <span>Valid cron expression</span>
          {warnings.length > 0 && (
            <div className='mt-1 space-y-1'>
              {warnings.map((warning, index) => (
                <div key={index} className='text-yellow-600 flex items-center gap-1'>
                  <Lightbulb className='h-3 w-3' />
                  {warning}
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className='text-xs space-y-1'>
        <span className='text-red-600'>Invalid cron expression:</span>
        {errors.map((error, index) => (
          <div key={index} className='text-red-600'>
            • {error}
          </div>
        ))}
        {warnings.length > 0 && (
          <div className='mt-1 space-y-1'>
            {warnings.map((warning, index) => (
              <div key={index} className='text-yellow-600 flex items-center gap-1'>
                <Lightbulb className='h-3 w-3' />
                {warning}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Tooltip contentComponent={getTooltipContent()}>
      <ActionButton className={cn(isValid ? 'text-good-400' : 'text-bad-400 hover:bg-bad-50')}>
        {isValid ? <Check className='size-4' /> : <AlertCircle className='size-4' />}
      </ActionButton>
    </Tooltip>
  )
}

interface PresetSelectorProps {
  onSelectPreset: (value: string) => void
  disabled?: boolean
}

/**
 * Preset selector component with command UI in a popover
 */
const PresetSelector: React.FC<PresetSelectorProps> = ({ onSelectPreset, disabled }) => {
  const [open, setOpen] = useState(false)

  // Common cron presets
  const presets = [
    { label: 'Every minute', value: '* * * * *', description: 'Runs every minute' },
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
    {
      label: 'Weekdays at 9 AM',
      value: '0 9 * * 1-5',
      description: 'Runs Monday-Friday at 9:00 AM',
    },
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

  const handleSelectPreset = (preset: (typeof presets)[0]) => {
    onSelectPreset(preset.value)
    setOpen(false)
    toastSuccess({ title: 'Preset applied', description: `Applied "${preset.label}"` })
  }

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
            <CommandGroup heading='Common Presets'>
              {presets.map((preset, index) => (
                <CommandItem
                  key={index}
                  value={`${preset.label} ${preset.description}`}
                  onSelect={() => handleSelectPreset(preset)}>
                  <div className='flex-1'>
                    <div className='font-medium text-sm'>{preset.label}</div>
                    <div className='text-xs text-muted-foreground font-mono'>{preset.value}</div>
                    <div className='text-xs text-muted-foreground'>{preset.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Cron format help component with format information in a popover
 */
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
            <h3 className='text-sm font-semibold'>Cron Format</h3>
          </div>

          <div className='text-xs text-muted-foreground'>
            Fields: minute (0-59) | hour (0-23) | day (1-31) | month (1-12) | weekday (0-7)
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <p className='font-medium mb-2 text-sm'>Special Characters:</p>
              <ul className='space-y-1 text-xs text-muted-foreground'>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>*</code>
                  <span>Any value</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>,</code>
                  <span>Multiple values</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>-</code>
                  <span>Range of values</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>/</code>
                  <span>Step values</span>
                </li>
              </ul>
            </div>
            <div>
              <p className='font-medium mb-2 text-sm'>Examples:</p>
              <ul className='space-y-1 text-xs text-muted-foreground'>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>*/15</code>
                  <span>Every 15 units</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>1-5</code>
                  <span>Range 1 to 5</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>1,3,5</code>
                  <span>Values 1, 3, and 5</span>
                </li>
                <li className='flex items-center gap-2'>
                  <code className='bg-muted px-1 py-0.5 rounded text-xs'>*/2</code>
                  <span>Every 2nd value</span>
                </li>
              </ul>
            </div>
          </div>

          <div className='pt-2 border-t'>
            <p className='font-medium mb-2 text-sm'>Common Examples:</p>
            <div className='space-y-2 text-xs'>
              <div className='flex justify-between'>
                <code className='bg-muted px-2 py-1 rounded'>0 * * * *</code>
                <span className='text-muted-foreground'>Every hour</span>
              </div>
              <div className='flex justify-between'>
                <code className='bg-muted px-2 py-1 rounded'>0 9 * * 1-5</code>
                <span className='text-muted-foreground'>Weekdays at 9 AM</span>
              </div>
              <div className='flex justify-between'>
                <code className='bg-muted px-2 py-1 rounded'>*/30 * * * *</code>
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
 * Advanced cron expression editor with validation and helpers
 */
export const CronEditor: React.FC<CronEditorProps> = ({
  value,
  onChange,
  disabled,
  config,
  placeholder = '0 * * * * (every hour)',
}) => {
  const [localValue, setLocalValue] = useState(value)
  const [validationResult, setValidationResult] = useState(validateScheduledTriggerConfig(config))
  const [isFocused, setIsFocused] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  // Debounce the parent onChange to prevent lag while typing
  const debouncedOnChange = useDebouncedCallback(onChange, 300)

  const handleCopy = useCallback(() => {
    copy(localValue)
    setIsCopied(true)
    setTimeout(() => {
      setIsCopied(false)
    }, 2000)
  }, [localValue])

  // Update validation when value changes
  useEffect(() => {
    const tempConfig = { ...config, customCron: localValue }
    setValidationResult(validateScheduledTriggerConfig(tempConfig))
  }, [localValue, config])

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (newValue: string) => {
    setLocalValue(newValue)
    debouncedOnChange(newValue)
  }

  const handlePresetChange = (newValue: string) => {
    setLocalValue(newValue)
    // For presets, update parent immediately for better UX
    onChange(newValue)
  }

  return (
    <div className='space-y-4'>
      {/* Cron Expression Input */}
      <div>
        <div
          className={cn(
            'focus-within:bg-gradient-to-r from-[#0ba5ec] to-[#155aef]',
            'bg-transparent',
            '!rounded-[9px] p-0.5 w-full'
          )}>
          <div
            className={cn(
              'bg-primary-100 rounded-lg border overflow-hidden focus-within:bg-background'
            )}>
            <div className='flex h-7 items-center justify-between px-2 pt-1'>
              <div className='flex items-center gap-2'>
                <div className='text-xs font-semibold uppercase text-primary-500'>Cron</div>
              </div>

              {/* Operations section */}
              <div
                className='flex items-center'
                onClick={(e) => {
                  e.nativeEvent.stopImmediatePropagation()
                  e.stopPropagation()
                }}>
                {/* Operation buttons */}
                <div className='flex items-center'>
                  {/* Copy button */}
                  <Tooltip content={isCopied ? 'Copied!' : 'Copy code'}>
                    <ActionButton onClick={handleCopy}>
                      {!isCopied ? (
                        <Clipboard className='size-4 cursor-pointer' />
                      ) : (
                        <ClipboardCheck className='size-4' />
                      )}
                    </ActionButton>
                  </Tooltip>
                  <Tooltip content='Cron Format Help'>
                    <CronFormatHelp />
                  </Tooltip>
                  <Tooltip content='Presets'>
                    <PresetSelector onSelectPreset={handlePresetChange} disabled={disabled} />
                  </Tooltip>

                  <ValidationResult
                    isValid={validationResult.isValid}
                    errors={validationResult.errors}
                    warnings={validationResult.warnings}
                  />
                </div>
              </div>
            </div>
            <div className='h-full pb-4 pl-2 pr-2'>
              <div className='relative h-full'>
                <Textarea
                  id='cron-expression'
                  value={localValue}
                  onChange={(e) => handleChange(e.target.value)}
                  disabled={disabled}
                  className='h-[20px] min-h-0 px-2 py-0 font-mono text-sm focus-visible:outline-none focus-visible:ring-0 resize-none border-0 bg-transparent shadow-none'
                  rows={2}
                />
                {/* Placeholder overlay */}
                {!localValue && !isFocused && placeholder && (
                  <div className='pointer-events-none absolute left-[10px] top-0 text-[13px] font-normal leading-[18px] text-gray-300'>
                    {placeholder}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
