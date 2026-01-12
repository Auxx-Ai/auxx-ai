// apps/web/src/app/(protected)/app/tickets/_components/ticket-link-dialog.tsx
'use client'

import { useMemo, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { api } from '~/trpc/react'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { toResourceId, getInstanceId, type ResourceId } from '@auxx/lib/field-values/client'

/**
 * Relation types with human-readable labels
 */
const RELATION_TYPES = [
  { value: 'RELATED', label: 'Related to' },
  { value: 'BLOCKED_BY', label: 'Blocked by' },
  { value: 'DUPLICATE_OF', label: 'Duplicate of' },
  { value: 'PARENT_OF', label: 'Parent of' },
  { value: 'CHILD_OF', label: 'Child of' },
  { value: 'CONVERTED_FROM', label: 'Converted from' },
]

/**
 * Props for TicketLinkDialog component
 */
interface TicketLinkDialogProps {
  ticketId: string
  relatedTicketIds: string[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: () => void
  trigger?: React.ReactNode
}

/**
 * TicketLinkDialog component - allows linking tickets with different relation types
 * Uses MultiRelationInput to fetch and select tickets internally
 */
export function TicketLinkDialog({
  ticketId,
  relatedTicketIds,
  open,
  onOpenChange,
  onSuccess,
  trigger,
}: TicketLinkDialogProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Use controlled or uncontrolled open state
  const dialogOpen = open ?? isOpen
  const setDialogOpen = onOpenChange ?? setIsOpen

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent size="sm">
        <TicketLinkDialogContent
          ticketId={ticketId}
          relatedTicketIds={relatedTicketIds}
          onClose={() => setDialogOpen(false)}
          onSuccess={onSuccess}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Inner content props */
interface TicketLinkDialogContentProps {
  ticketId: string
  relatedTicketIds: string[]
  onClose: () => void
  onSuccess?: () => void
}

/** Inner content component */
function TicketLinkDialogContent({
  ticketId,
  relatedTicketIds,
  onClose,
  onSuccess,
}: TicketLinkDialogContentProps) {
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [relationType, setRelationType] = useState<string>('RELATED')

  // Combine current ticket + already related into excludeIds
  const excludeIds = useMemo(
    () => [ticketId, ...relatedTicketIds],
    [ticketId, relatedTicketIds]
  )

  // Convert selectedTicketId to ResourceId[]
  const selectedResourceIds = useMemo(
    () => (selectedTicketId ? [toResourceId('ticket', selectedTicketId)] : []),
    [selectedTicketId]
  )

  // Handle selection change from MultiRelationInput
  const handleChange = useCallback((resourceIds: ResourceId[]) => {
    setSelectedTicketId(resourceIds[0] ? getInstanceId(resourceIds[0]) : null)
  }, [])

  // Mutation to add a relation
  const addRelationMutation = api.ticket.addRelation.useMutation({
    onSuccess: () => {
      onClose()
      setSelectedTicketId(null)
      setRelationType('RELATED')
      onSuccess?.()
    },
  })

  /** Handle adding a relation */
  const handleAddRelation = async () => {
    if (!selectedTicketId) return

    await addRelationMutation.mutateAsync({
      ticketId,
      relatedTicketId: selectedTicketId,
      relation: relationType,
    })
  }

  return (
    <>
      <DialogHeader className="mb-4">
        <DialogTitle>Link a related ticket</DialogTitle>
        <DialogDescription>Connect this ticket to another existing ticket.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="space-y-1 flex flex-col">
          <label className="text-sm font-medium">Relation type</label>
          <Select value={relationType} onValueChange={setRelationType}>
            <SelectTrigger>
              <SelectValue placeholder="Select relation type" />
            </SelectTrigger>
            <SelectContent>
              {RELATION_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 flex flex-col">
          <label className="text-sm font-medium">Select ticket</label>
          <MultiRelationInput
            entityDefinitionId="ticket"
            value={selectedResourceIds}
            onChange={handleChange}
            excludeIds={excludeIds}
            placeholder="Search tickets..."
            multi={false}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel <Kbd shortcut="esc" variant="outline" size="sm" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddRelation}
          disabled={!selectedTicketId || addRelationMutation.isPending}
          loading={addRelationMutation.isPending}
          loadingText="Adding..."
          data-dialog-submit>
          Add Link <KbdSubmit variant="outline" size="sm" />
        </Button>
      </DialogFooter>
    </>
  )
}
