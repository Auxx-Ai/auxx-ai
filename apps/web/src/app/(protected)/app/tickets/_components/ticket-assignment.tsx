// src/components/tickets/TicketAssignment.tsx
'use client'

import { useState, useEffect } from 'react'
// import { api } from '@/utils/api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Button } from '@auxx/ui/components/button'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Separator } from '@auxx/ui/components/separator'
import { X, User, UserPlus, Loader2 } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
// import { formatDate } from '@auxx/lib/utils'

interface Assignment {
  id: string
  agentId: string
  isActive: boolean
  assignedAt: Date
  agent: { id: string; name: string | null; email: string }
}

interface Agent {
  id: string
  name: string | null
  email: string
}

interface TicketAssignmentProps {
  ticketId: string
  currentAssignments: Assignment[]
  onAssignmentChanged: () => void
}

export function TicketAssignment({
  ticketId,
  currentAssignments = [],
  onAssignmentChanged,
}: TicketAssignmentProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')

  // Query to get all available agents
  const { data: availableAgents, isLoading: isLoadingAgents } =
    api.ticketAgent.getAvailableAgents.useQuery()

  // Current active agents
  const activeAssignments = currentAssignments.filter((a) => a.isActive)

  // Filter out already assigned agents from the available list
  const unassignedAgents =
    availableAgents?.filter(
      (agent) => !activeAssignments.some((assignment) => assignment.agentId === agent.id)
    ) || []

  // Mutation to assign an agent to the ticket
  const assignAgentMutation = api.ticket.assignAgent.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Agent assigned',
        description: 'The agent has been assigned to this ticket.',
      })
      setSelectedAgentId('')
      onAssignmentChanged()
    },
    onError: (error) => {
      toastError({
        title: 'Error assigning agent',
        description: error.message,
        // variant: 'destructive',
      })
    },
  })

  // Mutation to unassign an agent
  const unassignAgentMutation = api.ticket.unassignAgent.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Agent unassigned',
        description: 'The agent has been removed from this ticket.',
      })
      onAssignmentChanged()
    },
    onError: (error) => {
      toastError({ title: 'Error removing agent', description: error.message })
    },
  })

  const handleAssignAgent = () => {
    if (!selectedAgentId) return

    assignAgentMutation.mutate({ ticketId, agentId: selectedAgentId })
  }

  const handleUnassignAgent = (assignmentId: string) => {
    unassignAgentMutation.mutate({ assignmentId })
  }

  // Get initials for avatar
  const getInitials = (name: string | null, email: string): string => {
    if (name) {
      return name
        .split(' ')
        .map((part) => part.charAt(0))
        .join('')
        .toUpperCase()
        .substring(0, 2)
    }
    return email.charAt(0).toUpperCase()
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-lg font-medium">Assigned Agents</h3>

        {activeAssignments.length === 0 ? (
          <div className="text-sm italic text-gray-500">No agents currently assigned</div>
        ) : (
          <div className="space-y-2">
            {activeAssignments.map((assignment) => (
              <div
                key={assignment.id}
                className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
                <div className="flex items-center space-x-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      {getInitials(assignment.agent.name, assignment.agent.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">
                      {assignment.agent.name || assignment.agent.email}
                    </div>
                    <div className="text-xs text-gray-500">
                      Assigned {formatDate(assignment.assignedAt)}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUnassignAgent(assignment.id)}
                  disabled={unassignAgentMutation.isPending}>
                  <X className=" text-gray-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div className="flex items-end space-x-2">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium">Assign Agent</label>
          <Select
            value={selectedAgentId}
            onValueChange={setSelectedAgentId}
            disabled={isLoadingAgents || unassignedAgents.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder="Select an agent" />
            </SelectTrigger>
            <SelectContent>
              {isLoadingAgents ? (
                <div className="flex items-center justify-center p-2">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  <span>Loading agents...</span>
                </div>
              ) : unassignedAgents.length === 0 ? (
                <div className="p-2 text-sm text-gray-500">No available agents to assign</div>
              ) : (
                unassignedAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name || agent.email}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleAssignAgent}
          disabled={!selectedAgentId || assignAgentMutation.isPending}
          loading={assignAgentMutation.isPending}
          loadingText="Assigning...">
          <UserPlus />
          Assign
        </Button>
      </div>

      {currentAssignments.length > activeAssignments.length && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-500">Previous Assignments</h4>
          <div className="space-y-1">
            {currentAssignments
              .filter((a) => !a.isActive)
              .map((assignment) => (
                <div key={assignment.id} className="flex items-center text-sm text-gray-500">
                  <span>{assignment.agent.name || assignment.agent.email}</span>
                  <span className="mx-2">•</span>
                  <span>{formatDate(assignment.assignedAt)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
