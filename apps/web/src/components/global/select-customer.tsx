'use client'
import { keepPreviousData } from '@tanstack/react-query'

import { useCallback, useId, useEffect, useState, useRef } from 'react'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Label } from '@auxx/ui/components/label'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { CheckIcon, ChevronDownIcon, Loader2 } from 'lucide-react'
// import { api } from '@/trpc/react'
// import { useDebounce } from '@/lib/hooks/use-debounce'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { useFormContext } from 'react-hook-form'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { getFullName } from '@auxx/lib/utils'
import { cn } from '@auxx/ui/lib/utils'

type Customer = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}

interface CustomerSelectProps {
  onSelect?: (customer: { id: string; name: string }) => void
  label?: string
  placeholder?: string
  className?: string
  name?: string
  description?: string
  defaultValue?: string
  required?: boolean
  disabled?: boolean
  error?: string
}

type CustomerSelectWithRefProps = CustomerSelectProps & React.RefAttributes<HTMLButtonElement>

const CustomerSelect: React.FC<CustomerSelectWithRefProps> = (props) => {
  const {
    onSelect,
    label = 'Select Customer',
    placeholder = 'Search Customer...',
    className,
    name,
    description,
    defaultValue,
    required,
    disabled,
    error,
  } = props

  const id = useId()
  const [open, setOpen] = useState<boolean>(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  // Fetch customers with pagination
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    api.contact.search.useInfiniteQuery(
      { limit: 20, search: debouncedSearch },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
      }
    )

  // Flatten the pages into a single array of customers
  const customers = data?.pages.flatMap((page) => page.items) ?? []

  // Fetch a single customer by ID when needed
  const { data: customerData } = api.contact.getById.useQuery(
    { id: defaultValue || '' },
    {
      enabled: !!defaultValue && !selectedCustomer,
      onSuccess: (data) => {
        if (data) {
          setSelectedCustomer(data)
        }
      },
      refetchOnWindowFocus: false,
    }
  )

  // Reference to store selected customer ID for scrolling
  const selectedCustomerRef = useRef<string | null>(null)

  // Ref for CommandList to control scrolling
  const commandListRef = useRef<HTMLDivElement>(null)

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      setSearch('')
    }
  }, [open])

  // Load more customers when scrolling to bottom
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollHeight, scrollTop, clientHeight } = e.currentTarget
      if (scrollHeight - scrollTop - clientHeight < 50 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  )

  // Load more customers when scrolling to bottom
  // const handleScroll = useCallback(
  //   (e: React.UIEvent<HTMLDivElement>) => {
  //     const { scrollHeight, scrollTop, clientHeight } = e.currentTarget
  //     if (
  //       scrollHeight - scrollTop - clientHeight < 50 &&
  //       hasNextPage &&
  //       !isFetchingNextPage
  //     ) {
  //       fetchNextPage()
  //     }
  //   },
  //   [fetchNextPage, hasNextPage, isFetchingNextPage]
  // )

  // Format customer display name
  // const getCustomerDisplayName = (customer: Customer): string => {
  //   if (customer.firstName && customer.lastName) {
  //     return `${customer.firstName} ${customer.lastName}`
  //   } else if (customer.firstName) {
  //     return customer.firstName
  //   } else if (customer.lastName) {
  //     return customer.lastName
  //   } else if (customer.email) {
  //     return customer.email
  //   } else if (customer.phone) {
  //     return customer.phone
  //   } else {
  //     return `Customer #${customer.id}`
  //   }
  // }

  // Highlight the search term in text
  const highlightSearchTerm = (text: string | null, searchTerm: string) => {
    if (!text || !searchTerm.trim()) return text

    try {
      const regex = new RegExp(`(${searchTerm.trim()})`, 'gi')
      const parts = text.split(regex)

      if (parts.length <= 1) return text

      return parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} className="bg-yellow-100 dark:bg-yellow-900/40">
            {part}
          </span>
        ) : (
          part
        )
      )
    } catch (e) {
      // If regex fails (e.g., with special characters), return the text as is
      return text
    }
  }

  // Handle search input changes
  const handleSearchChange = (value: string) => {
    setSearch(value)
  }
  // Function to check if we should fetch the selected customer again
  const shouldFetchSelectedCustomer = useCallback(() => {
    // If we have a selected customer ID reference but not in the current list
    if (
      open &&
      selectedCustomerRef.current &&
      !customers.some((c) => c.id.toString() === selectedCustomerRef.current) &&
      !isLoading
    ) {
      return true
    }
    return false
  }, [open, customers, isLoading])

  useEffect(() => {
    const shouldFetch = shouldFetchSelectedCustomer()

    if (shouldFetch) {
      // Set the search to empty to ensure we load fresh data
      setSearch('')

      // This will trigger a re-fetch that should include the selected customer
      if (hasNextPage) {
        fetchNextPage()
      }
    }
  }, [shouldFetchSelectedCustomer, fetchNextPage, hasNextPage])

  // Handle customer selection
  const handleSelect = useCallback(
    (customer: Customer) => {
      setSelectedCustomer(customer)
      setOpen(false)

      if (onSelect) {
        onSelect({ id: customer.id.toString(), name: getFullName(customer) })
      }
    },
    [onSelect]
  )

  // Render the select component with or without form context
  const renderSelect = (fieldValue?: string, fieldOnChange?: (value: string) => void) => {
    return (
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button
            ref={props.ref}
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'w-full justify-between border-input focus-visible:ring-1 focus-visible:ring-blue-500 bg-background px-3 font-normal outline-hidden outline-offset-0 hover:bg-background focus-visible:outline-[3px]',
              error && 'border-destructive'
            )}>
            <span
              className={cn(
                'truncate',
                !selectedCustomer && !fieldValue && 'text-muted-foreground'
              )}>
              {selectedCustomer
                ? getFullName(selectedCustomer)
                : fieldValue
                  ? `Customer #${fieldValue}`
                  : 'Select Customer'}
            </span>
            <ChevronDownIcon
              size={16}
              className="shrink-0 text-muted-foreground/80"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) border-input p-0"
          align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder}
              value={search}
              onValueChange={handleSearchChange}
            />
            <CommandList className="max-h-[300px] overflow-auto" onScroll={handleScroll}>
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : customers.length === 0 ? (
                <CommandEmpty>No customers found.</CommandEmpty>
              ) : (
                // <ScrollArea>
                <CommandGroup>
                  {customers.map((customer) => (
                    <CommandItem
                      key={customer.id.toString()}
                      value={customer.id.toString()}
                      onSelect={() => {
                        if (fieldOnChange) {
                          fieldOnChange(customer.id.toString())
                        }
                        handleSelect(customer)
                      }}>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {customer.firstName && customer.lastName ? (
                            <>
                              {highlightSearchTerm(customer.firstName, debouncedSearch)}{' '}
                              {highlightSearchTerm(customer.lastName, debouncedSearch)}
                            </>
                          ) : customer.firstName ? (
                            highlightSearchTerm(customer.firstName, debouncedSearch)
                          ) : customer.lastName ? (
                            highlightSearchTerm(customer.lastName, debouncedSearch)
                          ) : customer.email ? (
                            highlightSearchTerm(customer.email, debouncedSearch)
                          ) : customer.phone ? (
                            highlightSearchTerm(customer.phone, debouncedSearch)
                          ) : (
                            `Customer #${customer.id}`
                          )}
                        </span>
                        {customer.email && (
                          <span className="text-xs text-muted-foreground">
                            {highlightSearchTerm(customer.email, debouncedSearch)}
                          </span>
                        )}
                      </div>
                      {(selectedCustomer?.id === customer.id ||
                        fieldValue === customer.id.toString()) && (
                        <CheckIcon size={16} className="ml-auto" />
                      )}
                    </CommandItem>
                  ))}
                  {isFetchingNextPage && (
                    <div className="flex items-center justify-center py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </CommandGroup>
                // </ScrollArea>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    )
  }

  // Render as form field if in a form context
  if (name) {
    try {
      const form = useFormContext()

      if (form) {
        return (
          <FormField
            control={form.control}
            name={name}
            defaultValue={defaultValue || ''}
            render={({ field }) => (
              <FormItem className={className}>
                {label && (
                  <FormLabel htmlFor={id}>
                    {label}
                    {required && <span className="ml-1 text-destructive">*</span>}
                  </FormLabel>
                )}
                <FormControl>{renderSelect(field.value, field.onChange)}</FormControl>
                {description && <FormDescription>{description}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
        )
      }
    } catch (e) {
      // Form context error - fall back to standard rendering
    }
  }

  // Render standalone component
  return (
    <div className={cn('not-first:*:mt-2', className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
      )}
      {renderSelect(defaultValue)}
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  )
}

CustomerSelect.displayName = 'CustomerSelect'

export default CustomerSelect
