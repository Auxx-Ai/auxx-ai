// apps/web/src/app/(protected)/app/tickets/_components/dialog-mass-assign.tsx

'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Badge } from '@auxx/ui/components/badge'
import { X } from 'lucide-react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useRecordInvalidation } from '~/components/resources'

interface MassAssignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketIds: string[]
  onSuccess: () => void
}

export function MassAssignDialog({
  open,
  onOpenChange,
  ticketIds,
  onSuccess,
}: MassAssignDialogProps) {
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const { onBulkUpdated } = useRecordInvalidation()

  // Get available agents
  const { data: agents, isLoading: agentsLoading } = api.ticketAgent.getAvailableAgents.useQuery(
    undefined,
    {
      refetchOnWindowFocus: false,
      enabled: open, // Only fetch when dialog is open
    }
  )

  const updateAssignmentMutation = api.ticket.updateMultipleAssignments.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `Successfully assigned ${ticketIds.length} ticket(s)` })
      onBulkUpdated('ticket', ticketIds)
      onSuccess()
      onOpenChange(false)
      setSelectedAgentIds([]) // Reset selection on success
    },
    onError: (error) => {
      toastError({ description: `Error: ${error.message}` })
    },
  })

  const handleSubmit = async () => {
    if (selectedAgentIds.length === 0) {
      toast.error('Please select at least one agent')
      return
    }

    await updateAssignmentMutation.mutateAsync({ ticketIds, agentIds: selectedAgentIds })
  }

  const handleAgentSelect = (agentId: string) => {
    if (!selectedAgentIds.includes(agentId)) {
      setSelectedAgentIds([...selectedAgentIds, agentId])
    }
  }

  const handleRemoveAgent = (agentId: string) => {
    setSelectedAgentIds(selectedAgentIds.filter((id) => id !== agentId))
  }

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      // Reset state when dialog closes
      setSelectedAgentIds([])
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>Assign Tickets</DialogTitle>
          <DialogDescription>
            Assign {ticketIds.length} selected ticket(s) to agents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1 flex flex-col">
            <label className="text-sm font-medium">Select Agents</label>
            <Select
              disabled={agentsLoading || updateAssignmentMutation.isPending}
              onValueChange={handleAgentSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((agent) => (
                  <SelectItem
                    key={agent.id}
                    value={agent.id}
                    disabled={selectedAgentIds.includes(agent.id)}>
                    {agent.name || agent.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedAgentIds.length > 0 && (
            <div className="space-y-1 flex flex-col">
              <label className="text-sm font-medium">Selected Agents</label>
              <div className="flex flex-wrap gap-2">
                {selectedAgentIds.map((agentId) => {
                  const agent = agents?.find((a) => a.id === agentId)
                  return (
                    <Badge key={agentId} variant="secondary" className="flex items-center gap-1">
                      {agent ? agent.name || agent.email : agentId}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() => handleRemoveAgent(agentId)}
                      />
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDialogClose(false)}
            disabled={updateAssignmentMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSubmit}
            disabled={updateAssignmentMutation.isPending || selectedAgentIds.length === 0}
            loading={updateAssignmentMutation.isPending}
            loadingText="Assigning...">
            Assign Tickets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
