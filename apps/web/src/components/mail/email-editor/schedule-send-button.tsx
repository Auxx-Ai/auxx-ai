// apps/web/src/components/mail/email-editor/schedule-send-button.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { Calendar, ChevronDown, CornerDownLeft, Send, Sun, Sunrise, Sunset, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { DateTimePickerContent } from '~/components/pickers/date-time-picker'
import { MetaIcon } from '~/constants/icons'
import { useEditorActiveStateContext } from './editor-active-state-context'

interface ScheduleSendButtonProps {
  onSend: () => void
  onSchedule: (scheduledAt: Date) => void
  isSending?: boolean
  disabled?: boolean
  popoverClassName?: string
}

interface TimePreset {
  label: string
  time: string
  icon: React.ComponentType<any>
  getDate: () => Date
}

/** Filter to only allow 15-minute intervals. */
function fifteenMinuteFilter(minutes: string[]): string[] {
  return minutes.filter((m) => Number(m) % 15 === 0)
}

/** Format a Date for the scheduled badge display. */
function formatScheduledTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

/** Build smart time presets based on current local time. */
function useTimePresets(): TimePreset[] {
  return useMemo(() => {
    const now = new Date()
    const hour = now.getHours()
    const presets: TimePreset[] = []

    if (hour < 9) {
      presets.push({
        label: 'This morning',
        time: '9:00 AM',
        icon: Sunrise,
        getDate: () => {
          const d = new Date()
          d.setHours(9, 0, 0, 0)
          return d
        },
      })
    }

    if (hour < 13) {
      presets.push({
        label: 'This afternoon',
        time: '1:00 PM',
        icon: Sun,
        getDate: () => {
          const d = new Date()
          d.setHours(13, 0, 0, 0)
          return d
        },
      })
    }

    presets.push({
      label: 'Tomorrow morning',
      time: '9:00 AM',
      icon: Sunset,
      getDate: () => {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(9, 0, 0, 0)
        return d
      },
    })

    return presets
  }, [])
}

export function ScheduleSendButton({
  onSend,
  onSchedule,
  isSending,
  disabled,
  popoverClassName,
}: ScheduleSendButtonProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null)
  const activeState = useEditorActiveStateContext()
  const presets = useTimePresets()

  const handlePresetClick = useCallback((preset: TimePreset) => {
    setDropdownOpen(false)
    setScheduledAt(preset.getDate())
  }, [])

  const handleCustomDateConfirm = useCallback((date: Date | undefined) => {
    if (!date) return
    setDatePickerOpen(false)
    setScheduledAt(date)
  }, [])

  const handleSendLater = useCallback(() => {
    if (!scheduledAt) return
    onSchedule(scheduledAt)
    setScheduledAt(null)
  }, [scheduledAt, onSchedule])

  const handleSendNow = useCallback(() => {
    setScheduledAt(null)
    setDropdownOpen(false)
  }, [])

  const clearSchedule = useCallback(() => {
    setScheduledAt(null)
  }, [])

  const minDate = useMemo(() => new Date(), [])

  return (
    <div className='relative flex items-center ms-2 shrink-0'>
      {/* Scheduled time badge */}
      {scheduledAt && (
        <Badge
          variant='outline'
          className='absolute -top-7 right-0 gap-1 whitespace-nowrap text-[10px] leading-tight'>
          {formatScheduledTime(scheduledAt)}
          <button
            type='button'
            onClick={clearSchedule}
            className='ml-0.5 cursor-pointer rounded-full hover:bg-muted focus:outline-hidden'
            aria-label='Clear scheduled time'>
            <X className='size-2.5' />
          </button>
        </Badge>
      )}

      {/* Main send / send later button */}
      {scheduledAt ? (
        <Button
          className='min-w-[60px] gap-0 rounded-r-none border-r-0'
          onClick={handleSendLater}
          size='sm'
          disabled={disabled}
          loading={isSending}
          loadingText='Scheduling...'>
          Send later
        </Button>
      ) : (
        <Button
          className='min-w-[60px] gap-0 rounded-r-none border-r-0'
          onClick={onSend}
          size='sm'
          disabled={disabled}
          loading={isSending}
          loadingText='Sending...'>
          Send
          <Separator orientation='vertical' className='mx-1.5 h-3 opacity-50' />
          <MetaIcon className='size-3! opacity-80' />
          <CornerDownLeft className='size-3! opacity-80' />
        </Button>
      )}

      {/* Schedule dropdown trigger */}
      <Popover
        open={datePickerOpen}
        onOpenChange={(open) => {
          setDatePickerOpen(open)
          if (open) activeState.trackPopoverOpen('schedule-datepicker')
          else activeState.trackPopoverClose('schedule-datepicker')
        }}>
        <DropdownMenu
          open={dropdownOpen}
          onOpenChange={(open) => {
            setDropdownOpen(open)
            if (open) activeState.trackPopoverOpen('schedule-dropdown')
            else activeState.trackPopoverClose('schedule-dropdown')
          }}>
          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
              <Button className='rounded-l-none px-1.5' size='sm' disabled={disabled || isSending}>
                <ChevronDown className='size-3.5' />
              </Button>
            </DropdownMenuTrigger>
          </PopoverAnchor>
          <DropdownMenuContent align='end' className={popoverClassName}>
            {/* Send now option when a schedule is staged */}
            {scheduledAt && (
              <>
                <DropdownMenuItem onClick={handleSendNow}>
                  <Send className='mr-2 size-4 text-muted-foreground' />
                  Send now
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {presets.map((preset) => {
              const Icon = preset.icon
              return (
                <DropdownMenuItem key={preset.label} onClick={() => handlePresetClick(preset)}>
                  <Icon className='mr-2 size-4 text-muted-foreground' />
                  <span className='flex-1'>{preset.label}</span>
                  <span className='ml-4 text-xs text-muted-foreground'>{preset.time}</span>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setDropdownOpen(false)
                requestAnimationFrame(() => setDatePickerOpen(true))
              }}>
              <Calendar className='mr-2 size-4 text-muted-foreground' />
              Select date & time...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverContent
          align='end'
          side='top'
          className={cn('w-auto p-0', popoverClassName)}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}>
          <DateTimePickerContent
            mode='datetime'
            minDate={minDate}
            minuteFilter={fifteenMinuteFilter}
            onChange={handleCustomDateConfirm}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
