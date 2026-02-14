// apps/web/src/app/(protected)/app/settings/webhooks/_components/event-type-picker.tsx
'use client'

import { eventTypesList } from '@auxx/lib/webhooks/types'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Badge } from '@auxx/ui/components/badge'
import { Label } from '@auxx/ui/components/label'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface EventTypePickerProps {
  selectedEventTypes: string[]
  onChange: (eventTypes: string[]) => void
  disabled?: boolean
  label?: string
  placeholder?: string
}

export function EventTypePicker({
  selectedEventTypes,
  onChange,
  disabled = false,
  label = 'Event Types',
  placeholder = 'Select event types...',
}: EventTypePickerProps) {
  const [inputValue, setInputValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [highlightedOption, setHighlightedOption] = useState<string | null>(null)
  const [dropdownTop, setDropdownTop] = useState<number>(0)
  const inputRef = useRef<AutosizeInputRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Filter event types based on input
  const filteredEventTypes = eventTypesList
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(inputValue.toLowerCase()) ||
          item.value.toLowerCase().includes(inputValue.toLowerCase())
      ),
    }))
    .filter((group) => group.items.length > 0)

  // Flattened list for keyboard navigation
  const allOptions = filteredEventTypes.flatMap((group) => group.items)

  const toggleEventType = (value: string, e?: React.MouseEvent) => {
    // Prevent event propagation to keep dropdown open
    e?.preventDefault()
    e?.stopPropagation()

    if (selectedEventTypes.includes(value)) {
      onChange(selectedEventTypes.filter((type) => type !== value))
    } else {
      onChange([...selectedEventTypes, value])
    }
    setInputValue('')

    // Make sure input stays focused and dropdown remains open
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
      }
      setIsFocused(true)
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Tab, Escape -> close dropdown
    if (e.key === 'Tab' || e.key === 'Escape') {
      setIsFocused(false)
      return
    }

    // Enter -> select highlighted option
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedOption) {
        toggleEventType(highlightedOption)
      } else if (inputValue && allOptions.length > 0) {
        toggleEventType(allOptions[0].value)
      }
      return
    }

    // Arrow Down -> highlight next option
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isFocused) {
        setIsFocused(true)
        return
      }

      const index = highlightedOption
        ? allOptions.findIndex((option) => option.value === highlightedOption)
        : -1

      const nextIndex = index < allOptions.length - 1 ? index + 1 : 0
      setHighlightedOption(allOptions[nextIndex]?.value || null)
      return
    }

    // Arrow Up -> highlight previous option
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isFocused) {
        setIsFocused(true)
        return
      }

      const index = highlightedOption
        ? allOptions.findIndex((option) => option.value === highlightedOption)
        : allOptions.length

      const prevIndex = index > 0 ? index - 1 : allOptions.length - 1
      setHighlightedOption(allOptions[prevIndex]?.value || null)
      return
    }

    // Backspace with empty input -> remove last selected event type
    if (e.key === 'Backspace' && !inputValue && selectedEventTypes.length > 0) {
      onChange(selectedEventTypes.slice(0, -1))
      return
    }
  }

  const handleBadgeKeyDown = (e: React.KeyboardEvent, index: number, value: string) => {
    // Delete or Backspace -> remove the event type
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onChange(selectedEventTypes.filter((type) => type !== value))

      // Set focus to previous badge or input
      if (index > 0) {
        setHighlightedIndex(index - 1)
      } else {
        inputRef.current?.focus()
      }
      return
    }

    // Left arrow -> move to previous badge
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      setHighlightedIndex(index - 1)
      return
    }

    // Right arrow -> move to next badge or input
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (index < selectedEventTypes.length - 1) {
        setHighlightedIndex(index + 1)
      } else {
        setHighlightedIndex(null)
        inputRef.current?.focus()
      }
      return
    }
  }

  // Handle clicking on the container
  const handleContainerClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent bubbling

    // Only focus input if the click wasn't on a badge or dropdown
    if (
      e.target === e.currentTarget ||
      (e.currentTarget.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node))
    ) {
      inputRef.current?.focus()
      setIsFocused(true)
    }
  }

  // Handle badge click
  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent click from reaching container
    // Don't focus input or open dropdown
  }

  // Handle removing an event type
  const handleRemoveEventType = (e: React.MouseEvent, value: string) => {
    e.stopPropagation() // Prevent propagation to badge and container
    onChange(selectedEventTypes.filter((t) => t !== value))
    setHighlightedIndex(null)

    // Keep focus and dropdown state as is - don't change
    setTimeout(() => {
      inputRef.current?.focus()
      setIsFocused(true)
    }, 0)
  }

  // Find display label for event type
  const getEventTypeLabel = (value: string) => {
    for (const group of eventTypesList) {
      const item = group.items.find((item) => item.value === value)
      if (item) return item.label
    }
    return value
  }

  // Handle clicks outside to close dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [])

  useEffect(() => {
    // Scroll highlighted option into view
    if (highlightedOption && dropdownRef.current) {
      const element = dropdownRef.current.querySelector(`[data-value="${highlightedOption}"]`)
      if (element) {
        element.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedOption])

  // Update dropdown position when container size changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedEventTypes triggers position recalculation when items change container height
  useEffect(() => {
    const updateDropdownPosition = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const parentRect = containerRef.current.offsetParent?.getBoundingClientRect()
        if (parentRect) {
          setDropdownTop(rect.bottom - parentRect.top)
        }
      }
    }

    // Update position when focused or when selected items change
    if (isFocused) {
      updateDropdownPosition()
    }
  }, [isFocused, selectedEventTypes])

  return (
    <div className='space-y-2 relative'>
      {label && <Label>{label}</Label>}

      <div
        ref={containerRef}
        className={cn(
          'flex flex-col min-h-8 rounded-xl border border-input shadow-xs bg-primary-50 dark:bg-primary-100 px-1 py-1 text-sm',
          isFocused && 'ring-1 ring-blue-500 pb-0'
        )}
        onClick={handleContainerClick}>
        <div className={cn('flex min-w-0 flex-1 flex-wrap shrink-0 items-center gap-x-1')}>
          {selectedEventTypes.map((type, index) => (
            <Badge
              key={type}
              variant='user'
              tabIndex={0}
              onFocus={() => setHighlightedIndex(index)}
              onBlur={() => setHighlightedIndex(null)}
              onKeyDown={(e) => handleBadgeKeyDown(e, index, type)}
              onClick={handleBadgeClick} // Prevent opening/closing when clicking badge
              className={` ${
                highlightedIndex === index
                  ? 'focus:ring-offset-0 focus:ring-0 bg-blue-500 text-background focus:outline-hidden'
                  : ''
              }`}
              aria-selected={highlightedIndex === index}
              role='option'
              aria-label={`Event type: ${getEventTypeLabel(type)}`}>
              {getEventTypeLabel(type)}
              <button
                type='button'
                disabled={disabled}
                onClick={(e) => handleRemoveEventType(e, type)}
                className='ml-1 cursor-pointer focus:outline-hidden'
                aria-label={`Remove ${getEventTypeLabel(type)}`}>
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}
          <AutosizeInput
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            disabled={disabled}
            aria-label='Add event type'
            autoComplete='off'
            placeholder={selectedEventTypes.length === 0 ? placeholder : ''}
            minWidth={20}
            placeholderIsMinWidth
            inputClassName='bg-transparent p-1 text-sm outline-hidden placeholder:text-muted-foreground/60'
          />
        </div>
        {/* <div className={cn('', !isFocused && 'h-0')}></div> */}
      </div>

      {isFocused && filteredEventTypes.length > 0 && (
        <div
          ref={dropdownRef}
          className='absolute left-0 right-0 z-50 rounded-2xl border border-border bg-background shadow-md'
          style={{
            top: `${dropdownTop}px`,
            marginTop: '0.25rem',
          }}
          onClick={(e) => e.stopPropagation()} // Prevent clicks in dropdown from closing it
        >
          <div className='relative px-3 py-1 border-b border-border'>
            <Search className='absolute left-3 top-2 h-4 w-4 text-muted-foreground' />
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className='w-full border-none bg-transparent pl-6 text-sm outline-hidden'
              placeholder='Search event types...'
              onKeyDown={handleKeyDown} // Handle keyboard nav in search box too
            />
          </div>

          <div className='max-h-[200px] overflow-y-auto py-1'>
            {filteredEventTypes.map((group) => (
              <div key={group.value} className='px-1 py-1.5'>
                <div className='mb-1 px-2 text-xs font-semibold text-muted-foreground'>
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <div
                    key={item.value}
                    data-value={item.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-2xl px-2 py-1 text-sm ${
                      highlightedOption === item.value
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50'
                    }`}
                    onClick={(e) => toggleEventType(item.value, e)}
                    onMouseEnter={() => setHighlightedOption(item.value)}>
                    <div
                      className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                        selectedEventTypes.includes(item.value)
                          ? 'border-primary-200 bg-primary-100'
                          : 'border-primary-200'
                      }`}>
                      {selectedEventTypes.includes(item.value) && (
                        <Check className='size-3 text-foreground' />
                      )}
                    </div>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
