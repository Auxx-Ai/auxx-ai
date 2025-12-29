// apps/web/src/app/(protected)/app/tickets/_components/ticket-filter-bar.tsx
'use client'
import { useCallback, useMemo } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { X } from 'lucide-react'
import type { Ticket, TicketFilterState } from './ticket-provider'
interface TicketFilterBarProps {
  filterValue: TicketFilterState
  onFilterChange: (filter: TicketFilterState) => void
  tickets: Ticket[]
  totalTickets: number
}
export function TicketFilterBar({
  filterValue,
  onFilterChange,
  tickets,
  totalTickets,
}: TicketFilterBarProps) {
  // Count tickets by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    tickets.forEach((ticket) => {
      counts[ticket.status] = (counts[ticket.status] || 0) + 1
    })
    return counts
  }, [tickets])
  // Count tickets by type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    tickets.forEach((ticket) => {
      counts[ticket.type] = (counts[ticket.type] || 0) + 1
    })
    return counts
  }, [tickets])
  // Count tickets by priority
  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    tickets.forEach((ticket) => {
      counts[ticket.priority] = (counts[ticket.priority] || 0) + 1
    })
    return counts
  }, [tickets])
  // Get unique assignees
  const assignees = useMemo(() => {
    const uniqueAssignees = new Map<
      string,
      {
        id: string
        name: string
        email: string
      }
    >()
    tickets.forEach((ticket) => {
      ticket.assignments.forEach((assignment) => {
        if (!uniqueAssignees.has(assignment.agent.id)) {
          uniqueAssignees.set(assignment.agent.id, {
            id: assignment.agent.id,
            name: assignment.agent.name || '',
            email: assignment.agent.email,
          })
        }
      })
    })
    return Array.from(uniqueAssignees.values())
  }, [tickets])
  const handleStatusChange = useCallback(
    (value: string) => {
      onFilterChange({
        ...filterValue,
        status: value === 'all' ? undefined : value,
      })
    },
    [filterValue, onFilterChange]
  )
  const handleTypeChange = useCallback(
    (value: string) => {
      onFilterChange({
        ...filterValue,
        type: value === 'all' ? undefined : value,
      })
    },
    [filterValue, onFilterChange]
  )
  const handlePriorityChange = useCallback(
    (value: string) => {
      onFilterChange({
        ...filterValue,
        priority: value === 'all' ? undefined : value,
      })
    },
    [filterValue, onFilterChange]
  )
  const handleAssigneeChange = useCallback(
    (value: string) => {
      onFilterChange({
        ...filterValue,
        assignee: value === 'all' ? undefined : value,
      })
    },
    [filterValue, onFilterChange]
  )
  const clearFilters = useCallback(() => {
    onFilterChange({})
  }, [onFilterChange])
  const hasActiveFilters =
    filterValue.status || filterValue.type || filterValue.priority || filterValue.assignee
  return (
    <div className="flex flex-col gap-3 p-3 bg-muted/30 border-b">
      <div className="flex items-center gap-2">
        {/* Status Filter */}
        <Select value={filterValue.status || 'all'} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[180px]" size="sm">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              All Statuses {totalTickets > 0 && `(${totalTickets})`}
            </SelectItem>
            {Object.values(TicketStatus).map((status) => (
              <SelectItem key={status} value={status}>
                {status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ')}
                {statusCounts[status] ? ` (${statusCounts[status]})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Type Filter */}
        <Select value={filterValue.type || 'all'} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-[180px]" size="sm">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types {totalTickets > 0 && `(${totalTickets})`}</SelectItem>
            {Object.values(TicketType).map((type) => (
              <SelectItem key={type} value={type}>
                {type.charAt(0) + type.slice(1).toLowerCase().replace('_', ' ')}
                {typeCounts[type] ? ` (${typeCounts[type]})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Priority Filter */}
        <Select value={filterValue.priority || 'all'} onValueChange={handlePriorityChange}>
          <SelectTrigger className="w-[180px]" size="sm">
            <SelectValue placeholder="All Priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              All Priorities {totalTickets > 0 && `(${totalTickets})`}
            </SelectItem>
            {Object.values(TicketPriority).map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priority.charAt(0) + priority.slice(1).toLowerCase()}
                {priorityCounts[priority] ? ` (${priorityCounts[priority]})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Assignee Filter */}
        <Select value={filterValue.assignee || 'all'} onValueChange={handleAssigneeChange}>
          <SelectTrigger className="w-[200px]" size="sm">
            <SelectValue placeholder="All Assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assignees</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {assignees.map((assignee) => (
              <SelectItem key={assignee.id} value={assignee.id}>
                {assignee.name || assignee.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="ml-auto">
            <X />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {filterValue.status && (
            <Badge variant="secondary">
              Status: {filterValue.status.toLowerCase().replace('_', ' ')}
            </Badge>
          )}
          {filterValue.type && (
            <Badge variant="secondary">
              Type: {filterValue.type.toLowerCase().replace('_', ' ')}
            </Badge>
          )}
          {filterValue.priority && (
            <Badge variant="secondary">Priority: {filterValue.priority.toLowerCase()}</Badge>
          )}
          {filterValue.assignee && (
            <Badge variant="secondary">
              Assignee:{' '}
              {filterValue.assignee === 'unassigned'
                ? 'Unassigned'
                : assignees.find((a) => a.id === filterValue.assignee)?.name ||
                  filterValue.assignee}
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
