// apps/web/src/components/pickers/timezone-picker.tsx
'use client'

import { useState, useEffect, useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@auxx/ui/components/command'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { IANA_TIME_ZONES } from '@auxx/config/client'
import { formatInTimeZone } from 'date-fns-tz'
import { enUS } from 'date-fns/locale'
import { Check } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'

/**
 * Format timezone label with GMT offset and location
 */
const formatTimeZoneLabel = (ianaTimeZone: string) => {
  const timeZoneWithGmtOffset = formatInTimeZone(Date.now(), ianaTimeZone, `zzzz`, { locale: enUS })
  const ianaTimeZoneParts = ianaTimeZone.split('/')
  const location =
    ianaTimeZoneParts.length > 1 ? ianaTimeZoneParts.slice(-1)[0].replaceAll('_', ' ') : undefined

  const timeZoneLabel =
    !location || timeZoneWithGmtOffset.includes(location)
      ? timeZoneWithGmtOffset
      : [timeZoneWithGmtOffset, location].join(' - ')

  return timeZoneLabel
}

/**
 * Get GMT offset from timezone for grouping
 */
const getGmtOffset = (ianaTimeZone: string): string => {
  try {
    const offset = formatInTimeZone(Date.now(), ianaTimeZone, 'xxx', { locale: enUS })
    return offset
  } catch {
    return '+00:00'
  }
}

/**
 * Process timezone data for display
 */
interface ProcessedTimezone {
  value: string
  label: string
  offset: string
  searchableText: string
}

interface TimeZonePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected?: string
  onChange: (selected: string) => void
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  style?: React.CSSProperties
  children?: React.ReactNode // Custom trigger
}

export function TimeZonePicker({
  // open,
  // onOpenChange,
  selected,
  onChange,
  className,
  align = 'start',
  children,
  ...props
}: TimeZonePickerProps) {
  const [search, setSearch] = useState('')
  const [open, onOpenChange] = useState(false)
  // Process and group timezones
  const processedTimezones = useMemo(() => {
    const processed: ProcessedTimezone[] = IANA_TIME_ZONES.map((tz) => {
      const label = formatTimeZoneLabel(tz)
      const offset = getGmtOffset(tz)
      return { value: tz, label, offset, searchableText: `${tz} ${label} ${offset}`.toLowerCase() }
    })

    // Sort by offset first, then by label
    return processed.sort((a, b) => {
      const offsetCompare = a.offset.localeCompare(b.offset)
      if (offsetCompare !== 0) return offsetCompare
      return a.label.localeCompare(b.label)
    })
  }, [])

  // Group timezones by offset
  const groupedTimezones = useMemo(() => {
    const groups = new Map<string, ProcessedTimezone[]>()

    processedTimezones.forEach((tz) => {
      const group = groups.get(tz.offset) || []
      group.push(tz)
      groups.set(tz.offset, group)
    })

    return Array.from(groups.entries()).map(([offset, timezones]) => ({ offset, timezones }))
  }, [processedTimezones])

  // Filter timezones based on search
  const filteredGroups = useMemo(() => {
    if (!search) return groupedTimezones

    const searchLower = search.toLowerCase()
    return groupedTimezones
      .map((group) => ({
        ...group,
        timezones: group.timezones.filter((tz) => tz.searchableText.includes(searchLower)),
      }))
      .filter((group) => group.timezones.length > 0)
  }, [groupedTimezones, search])

  // Handle selection
  const handleSelect = (value: string) => {
    onChange(value)
    onOpenChange(false)
    setSearch('')
  }

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearch('')
    }
  }, [open])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children || (
          <Button variant="outline">
            {selected ? (
              <div className="flex items-center gap-2 truncate">
                <span className="truncate">{selected}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">Pick...</span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[400px] p-0', className)} align={align} {...props}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search timezone..." value={search} onValueChange={setSearch} />
          <CommandList>
            {filteredGroups.length === 0 ? (
              <CommandEmpty>No timezone found.</CommandEmpty>
            ) : (
              <div className="h-[300px]">
                {filteredGroups.map((group) => (
                  <CommandGroup heading={group.offset} key={group.offset}>
                    {group.timezones.map((tz) => (
                      <CommandItem
                        key={tz.value}
                        value={tz.value}
                        onSelect={() => handleSelect(tz.value)}
                        className="px-1">
                        <div className="flex flex-row items-center gap-2 w-full">
                          <Badge
                            size="sm"
                            variant="blue"
                            className="font-mono shrink-0 rounded-full">
                            {tz.offset}
                          </Badge>
                          <span className="truncate">{tz.label}</span>
                          {selected === tz.value && <Check className="size-4 shrink-0" />}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
