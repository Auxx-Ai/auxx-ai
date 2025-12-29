'use client'
import React, { useEffect, useState } from 'react'
import MultipleSelector, { Option } from '@auxx/ui/components/multiselect'
import { api } from '~/trpc/react'
import { debounce } from 'lodash'
import { getFullName } from '@auxx/lib/utils'

type CustomerMultiSelectProps = { value: Option[]; onChange: (value: Option[]) => void }

export function MultiSelectCustomers({ value, onChange }: CustomerMultiSelectProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [options, setOptions] = useState<Option[]>([])

  // Fetch customers query
  const customersQuery = api.contact.search.useQuery(
    { search: searchTerm },
    { enabled: searchTerm.length >= 2 }
  )
  console.log('Customers query:', customersQuery) // Debugging log

  // Helper function to format customer name
  /*const formatCustomerName = (customer: any) => {
    const name = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(' ')

    if (name) {
      return customer.email ? `${name} (${customer.email})` : name
    }

    return customer.email || customer.phone || `Customer #${customer.id}`
  }*/

  // Update options when query data changes
  useEffect(() => {
    if (customersQuery.data) {
      const customerOptions = customersQuery.data.items.map((customer) => ({
        value: customer.id.toString(),
        label: getFullName(customer),
      }))
      console.log('Customer options:', customerOptions) // Debugging log
      setOptions(customerOptions)
    }
  }, [customersQuery.data])

  // Create a debounced search function
  const debouncedSearch = React.useCallback(
    debounce((term: string) => {
      setSearchTerm(term)
    }, 300),
    []
  )

  // Handle search input
  const handleSearchInput = (term: string) => {
    if (term.length >= 2) {
      debouncedSearch(term)
    } else {
      setOptions([])
    }
  }

  // Determine the display message based on query state
  const getEmptyIndicator = () => {
    if (searchTerm.length < 2) {
      return 'Type at least 2 characters to search'
    }

    if (customersQuery.isLoading) {
      return 'Searching...'
    }

    return 'No customers found'
  }

  return (
    <MultipleSelector
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Search customers..."
      onSearch={handleSearchInput}
      emptyIndicator="No customers found"
      loadingIndicator={customersQuery.isLoading ? 'Searching customers...' : undefined}
      creatable={false}
    />
  )
}
