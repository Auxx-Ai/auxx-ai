// apps/web/src/components/pickers/currency-picker.tsx
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
import { CURRENCIES } from '@auxx/config/client'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'

/**
 * Process currency data for display and search
 */
interface ProcessedCurrency {
  code: string
  label: string
  symbol: string
  decimals: number
  searchableText: string
}

/**
 * Props for CurrencyPicker component
 */
interface CurrencyPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string
  onChange: (selected: string) => void
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  style?: React.CSSProperties
  children?: React.ReactNode
}

/**
 * CurrencyPicker component
 * A searchable dropdown for selecting currencies with code, label, and symbol display
 */
export function CurrencyPicker({
  selected,
  onChange,
  className,
  align = 'start',
  children,
  ...props
}: CurrencyPickerProps) {
  const [search, setSearch] = useState('')
  const [open, onOpenChange] = useState(false)

  // Process currencies for search
  const processedCurrencies = useMemo(() => {
    return CURRENCIES.map(
      (currency): ProcessedCurrency => ({
        code: currency.code,
        label: currency.label,
        symbol: currency.symbol,
        decimals: currency.decimals,
        searchableText: `${currency.code} ${currency.label} ${currency.symbol}`.toLowerCase(),
      })
    )
  }, [])

  // Filter currencies based on search
  const filteredCurrencies = useMemo(() => {
    if (!search) return processedCurrencies

    const searchLower = search.toLowerCase()
    return processedCurrencies.filter((currency) => currency.searchableText.includes(searchLower))
  }, [processedCurrencies, search])

  // Get selected currency for display
  const selectedCurrency = useMemo(() => {
    return processedCurrencies.find((c) => c.code === selected)
  }, [processedCurrencies, selected])

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
          <Button variant="input" size="default" className="w-full justify-between">
            {selectedCurrency ? (
              <div className="flex items-center gap-2 truncate">
                <span className="truncate">{selectedCurrency.label}</span>
                <Badge variant="gray" size="xs" className="font-mono shrink-0 me-1">
                  {selectedCurrency.code}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground">Select currency...</span>
            )}
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[350px] p-0', className)} align={align} {...props}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search currency..." value={search} onValueChange={setSearch} />
          <CommandList>
            {filteredCurrencies.length === 0 ? (
              <CommandEmpty>No currency found.</CommandEmpty>
            ) : (
              <div className="max-h-[300px] overflow-auto">
                <CommandGroup>
                  {filteredCurrencies.map((currency) => (
                    <CommandItem
                      key={currency.code}
                      value={currency.code}
                      onSelect={() => handleSelect(currency.code)}
                      className="px-2 ps-1">
                      <div className="flex flex-row items-center gap-2 w-full">
                        <Badge
                          size="sm"
                          variant="gray"
                          className="font-mono shrink-0 w-12 justify-center">
                          {currency.code}
                        </Badge>
                        <div className="flex-1">
                          <span className="truncate">{currency.label}</span>
                          <span className="text-info shrink-0 ps-1">{currency.symbol}</span>
                        </div>
                        {selected === currency.code && (
                          <Check className="size-4 shrink-0 text-muted-foregorund" />
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
