'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
// import { useQueryState, parseAsString } from 'nuqs/server'
import { Input } from '@auxx/ui/components/input'
import { SearchIcon } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
// import { TicketViewManager } from './TicketViewManager'
import MultipleSelector, { Option } from '@auxx/ui/components/multiselect'
// import { AssigneeMultiSelect } from './AssigneeMultiSelect'
import { parseAsString, useQueryState } from 'nuqs'
import { MultiSelectUsers } from '~/components/global/multi-select-users'
import { TicketViewManager } from './ticket-view-manager'
import { MultiSelectCustomers } from '~/components/global/multi-select-customers'
import { api } from '~/trpc/react'
// Helper function to get user name from ID
const getUserNameById = (teamMembers: any[], userId: string): string => {
  // Handle special cases
  if (userId === 'UNASSIGNED') return 'Unassigned'
  if (userId === 'ME') return 'Assigned to me'
  // Find the user in team members
  const user = teamMembers?.find((member) => member.id === userId)
  return user?.name || 'Unknown User'
}
export function TicketFilters() {
  const router = useRouter()
  // Use nuqs for search query
  const [searchQuery, setSearchQuery] = useQueryState('q', parseAsString.withDefault(''))
  const { data: teamMembers, isLoading } = api.user.teamMembers.useQuery()
  // We still need to manage the multi-select options with local state
  // as nuqs doesn't directly handle complex objects like Option[]
  const [statusOptions, setStatusOptions] = useState<Option[]>([])
  const [typeOptions, setTypeOptions] = useState<Option[]>([])
  const [priorityOptions, setPriorityOptions] = useState<Option[]>([])
  const [assigneeOptions, setAssigneeOptions] = useState<Option[]>([])
  const [customerOptions, setCustomerOptions] = useState<Option[]>([])
  // Use nuqs for the URL parameters
  const [statusFilter, setStatusFilter] = useQueryState('status', parseAsString.withDefault(''))
  const [typeFilter, setTypeFilter] = useQueryState('type', parseAsString.withDefault(''))
  const [priorityFilter, setPriorityFilter] = useQueryState(
    'priority',
    parseAsString.withDefault('')
  )
  const [assigneeFilter, setAssigneeFilter] = useQueryState(
    'assignee',
    parseAsString.withDefault('')
  )
  const [customerFilter, setCustomerFilter] = useQueryState(
    'customer',
    parseAsString.withDefault('')
  )
  // Initialize options from URL parameters
  useEffect(() => {
    // Status options
    if (statusFilter) {
      const values = statusFilter.split(',').filter(Boolean)
      setStatusOptions(
        values.map((status) => ({ value: status, label: status.replace(/_/g, ' ') }))
      )
    }
    // Type options
    if (typeFilter) {
      const values = typeFilter.split(',').filter(Boolean)
      setTypeOptions(values.map((type) => ({ value: type, label: type.replace(/_/g, ' ') })))
    }
    // Priority options
    if (priorityFilter) {
      const values = priorityFilter.split(',').filter(Boolean)
      setPriorityOptions(values.map((priority) => ({ value: priority, label: priority })))
    }
    if (assigneeFilter && teamMembers) {
      const values = assigneeFilter.split(',').filter(Boolean)
      setAssigneeOptions(
        values.map((assignee) => ({
          value: assignee,
          label: getUserNameById(teamMembers, assignee),
        }))
      )
    }
    // Assignee options
    /*
        if (assigneeFilter) {
          const values = assigneeFilter.split(',').filter(Boolean)
          setAssigneeOptions(
            values.map((assignee) => ({
              value: assignee,
              label:
                assignee === 'UNASSIGNED'
                  ? 'Unassigned'
                  : assignee === 'ME'
                    ? 'Assigned to me'
                    : assignee,
            }))
          )
        }*/
  }, [statusFilter, typeFilter, priorityFilter, assigneeFilter])
  // Update URL parameters when options change
  const handleStatusChange = (options: Option[]) => {
    setStatusOptions(options)
    setStatusFilter(options.length > 0 ? options.map((o) => o.value).join(',') : '')
  }
  const handleTypeChange = (options: Option[]) => {
    setTypeOptions(options)
    setTypeFilter(options.length > 0 ? options.map((o) => o.value).join(',') : '')
  }
  const handlePriorityChange = (options: Option[]) => {
    setPriorityOptions(options)
    setPriorityFilter(options.length > 0 ? options.map((o) => o.value).join(',') : '')
  }
  const handleAssigneeChange = (options: Option[]) => {
    setAssigneeOptions(options)
    setAssigneeFilter(options.length > 0 ? options.map((o) => o.value).join(',') : '')
  }
  const handleCustomerChange = (options: Option[]) => {
    setCustomerOptions(options)
    setCustomerFilter(options.length > 0 ? options.map((o) => o.value).join(',') : '')
  }
  // Current filter state to pass to the view manager
  const currentFilters = {
    status: statusOptions.map((o) => o.value),
    type: typeOptions.map((o) => o.value),
    priority: priorityOptions.map((o) => o.value),
    assigneeIds: assigneeOptions.map((o) => o.value),
    contactIds: customerOptions.map((o) => o.value),
    searchQuery: searchQuery || '',
  }
  // Load saved view
  const handleLoadView = (view: any) => {
    if (view.filters) {
      // Convert arrays of strings to arrays of Option objects
      const newStatusOptions = (view.filters.status || []).map((status: string) => ({
        value: status,
        label: status.replace(/_/g, ' '),
      }))
      const newTypeOptions = (view.filters.type || []).map((type: string) => ({
        value: type,
        label: type.replace(/_/g, ' '),
      }))
      const newPriorityOptions = (view.filters.priority || []).map((priority: string) => ({
        value: priority,
        label: priority,
      }))
      const newAssigneeOptions = (view.filters.assigneeIds || []).map((assigneeId: string) => ({
        value: assigneeId,
        label:
          assigneeId === 'UNASSIGNED'
            ? 'Unassigned'
            : assigneeId === 'ME'
              ? 'Assigned to me'
              : assigneeId,
      }))
      const newCustomerOptions = (view.filters.contactIds || []).map((contactId: string) => ({
        value: contactId,
        label: contactId === 'UNASSIGNED' ? 'Unassigned' : contactId,
      }))
      // Set the local state
      setStatusOptions(newStatusOptions)
      setTypeOptions(newTypeOptions)
      setPriorityOptions(newPriorityOptions)
      setAssigneeOptions(newAssigneeOptions)
      setCustomerOptions(newCustomerOptions)
      // Update the URL parameters using nuqs
      setStatusFilter(
        newStatusOptions.length > 0 ? newStatusOptions.map((o) => o.value).join(',') : ''
      )
      setTypeFilter(newTypeOptions.length > 0 ? newTypeOptions.map((o) => o.value).join(',') : '')
      setPriorityFilter(
        newPriorityOptions.length > 0 ? newPriorityOptions.map((o) => o.value).join(',') : ''
      )
      setAssigneeFilter(
        newAssigneeOptions.length > 0 ? newAssigneeOptions.map((o) => o.value).join(',') : ''
      )
      setCustomerFilter(
        newCustomerOptions.length > 0 ? newCustomerOptions.map((o) => o.value).join(',') : ''
      )
      setSearchQuery(view.filters.searchQuery || '')
    }
  }
  // Reset all filters
  const handleResetFilters = () => {
    setStatusOptions([])
    setTypeOptions([])
    setPriorityOptions([])
    setAssigneeOptions([])
    setCustomerOptions([])
    // Clear URL parameters
    setStatusFilter('')
    setTypeFilter('')
    setPriorityFilter('')
    setAssigneeFilter('')
    setSearchQuery('')
  }
  return (
    <div className="space-y-4  p-4 border border-t-0">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Filters</h3>
        <div className="flex items-center gap-2">
          <TicketViewManager currentFilters={currentFilters} onLoadView={handleLoadView} />
          <Button variant="ghost" size="sm" onClick={handleResetFilters}>
            Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Status</label>
          <MultipleSelector
            options={Object.values(TicketStatus).map((status) => ({
              value: status,
              label: status.replace(/_/g, ' '),
            }))}
            value={statusOptions}
            onChange={handleStatusChange}
            placeholder="Select statuses"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Type</label>
          <MultipleSelector
            options={Object.values(TicketType).map((type) => ({
              value: type,
              label: type.replace(/_/g, ' '),
            }))}
            value={typeOptions}
            onChange={handleTypeChange}
            placeholder="Select types"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Priority</label>
          <MultipleSelector
            options={Object.values(TicketPriority).map((priority) => ({
              value: priority,
              label: priority,
            }))}
            value={priorityOptions}
            onChange={handlePriorityChange}
            placeholder="Select priorities"
          />
        </div>
        {/* Assignment Filter */}
        <div>
          <label className="mb-1 block text-sm font-medium">Assigned To</label>
          <MultiSelectUsers value={assigneeOptions} onChange={handleAssigneeChange} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Customer</label>

          <MultiSelectCustomers value={customerOptions} onChange={handleCustomerChange} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Search</label>
          <div className="relative">
            <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tickets..."
              value={searchQuery || ''}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
