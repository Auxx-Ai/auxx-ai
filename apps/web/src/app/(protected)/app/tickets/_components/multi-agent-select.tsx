// components/MultiAgentSelect.tsx
'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { api } from '~/trpc/react'
import { cn } from '@auxx/ui/lib/utils'
// import { trpc } from '@/lib/trpc'

type Agent = { id: string; name: string | null; email: string | null }

interface MultiAgentSelectProps {
  ticketId: string
  onAgentsChange?: (agentIds: string[]) => void
  defaultSelectedAgents?: Agent[]
  className?: string
}

export function MultiAgentSelect({
  ticketId,
  onAgentsChange,
  defaultSelectedAgents = [],
  className,
}: MultiAgentSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [selectedAgents, setSelectedAgents] = React.useState<Agent[]>(() =>
    Array.isArray(defaultSelectedAgents) ? defaultSelectedAgents : []
  )
  const [inputValue, setInputValue] = React.useState('')

  // Fetch agents using tRPC
  const { data: agents, isLoading } = api.ticketAgent.getAvailableAgents.useQuery(undefined, {
    onError: (error) => {
      console.error('Error fetching users:', error)
    },
  })

  // Get current ticket assignments
  const { data: currentAssignments } = api.ticket.getAgents.useQuery(
    { ticketId },
    {
      enabled: !!ticketId, // Only run if ticketId exists
      onError: (error) => {
        console.error('Error fetching ticket assignments:', error)
      },
    }
  )

  // Get trpc context
  const utils = api.useUtils()

  // Create ticket assignment mutation
  const createAssignment = api.ticketAgent.addAgent.useMutation({
    onSuccess: () => {
      // Invalidate relevant queries to refresh data
      utils.ticket.getAgents.invalidate({ ticketId })
    },
    onError: (error) => {
      console.error('Error creating assignment:', error)
    },
  })

  // Remove ticket assignment mutation
  const removeAssignment = api.ticketAgent.removeAgent.useMutation({
    onSuccess: () => {
      // Invalidate relevant queries to refresh data
      utils.ticket.getAgents.invalidate({ ticketId })
    },
    onError: (error) => {
      console.error('Error removing assignment:', error)
    },
  })

  // Init selectedAgents from current assignments when data loads
  React.useEffect(() => {
    if (
      Array.isArray(currentAssignments) &&
      currentAssignments.length > 0 &&
      selectedAgents.length === 0
    ) {
      setSelectedAgents(
        currentAssignments.map((assignment) => ({
          id: assignment.agent.id,
          name: assignment.agent.name,
          email: assignment.agent.email,
        }))
      )
    }
  }, [currentAssignments, selectedAgents.length])

  // Sync with parent component when selected agents change
  React.useEffect(() => {
    if (onAgentsChange) {
      onAgentsChange(selectedAgents.map((agent) => agent.id))
    }
  }, [selectedAgents, onAgentsChange])

  // Filter out already selected agents and ensure we're dealing with arrays
  const filteredAgents = React.useMemo(() => {
    // Make sure agents is an array before filtering
    return (Array.isArray(agents) ? agents : []).filter(
      (agent) => !selectedAgents.some((selectedAgent) => selectedAgent.id === agent.id)
    )
  }, [agents, selectedAgents])

  const handleSelect = (agent: Agent) => {
    // Update local state immediately for responsive UI
    setSelectedAgents((prev) => [...prev, agent])

    // Only call the API if ticketId is valid
    if (ticketId) {
      createAssignment.mutate(
        { ticketId, agentId: agent.id },
        {
          onError: () => {
            // Revert the state change if the API call fails
            setSelectedAgents((prev) => prev.filter((a) => a.id !== agent.id))
          },
        }
      )
    }

    setInputValue('')
  }

  const handleRemove = (agentToRemove: Agent) => {
    // Update local state immediately for responsive UI
    setSelectedAgents((prev) => prev.filter((agent) => agent.id !== agentToRemove.id))

    // Only call the API if ticketId is valid
    if (ticketId) {
      removeAssignment.mutate(
        { ticketId, agentId: agentToRemove.id },
        {
          onError: () => {
            // Revert the state change if the API call fails
            setSelectedAgents((prev) => [...prev, agentToRemove])
          },
        }
      )
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            // variant='outline'
            role="combobox"
            aria-expanded={open}
            className="inline-flex h-auto w-full items-center justify-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background px-2 pb-1 pt-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0">
            {selectedAgents.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selectedAgents.map((agent) => (
                  <Badge key={agent.id} variant="secondary" className="mb-1 mr-1">
                    {agent.name || agent.email}
                    <button
                      className="ml-1 rounded-full outline-hidden ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          e.stopPropagation()
                          handleRemove(agent)
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={() => handleRemove(agent)}>
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove {agent.name || agent.email}</span>
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              'Assign agents...'
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent className="popover-content-width-same-as-its-trigger w-full p-0">
          <Command className="w-full">
            <CommandInput
              placeholder="Search agents..."
              className="h-9"
              value={inputValue}
              onValueChange={setInputValue}
            />
            <CommandList>
              <CommandEmpty>{isLoading ? 'Loading agents' : 'No agents found.'}</CommandEmpty>
              <CommandGroup className="max-h-64 overflow-auto">
                {!isLoading &&
                  filteredAgents.map((agent, i) => (
                    <CommandItem
                      key={agent.id}
                      value={agent.id}
                      onSelect={() => {
                        handleSelect(agent)
                        setOpen(false)
                      }}>
                      {agent.name || agent.email}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
