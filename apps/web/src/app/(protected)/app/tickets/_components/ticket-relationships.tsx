'use client'

import { useState } from 'react'
import { type RouterOutputs, api } from '~/trpc/react'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Plus, X, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'

type TicketProps = { ticket: RouterOutputs['ticket']['byId'] }

// Relation types with more human-readable labels
const RELATION_TYPES = [
  { value: 'RELATED', label: 'Related to' },
  { value: 'BLOCKED_BY', label: 'Blocked by' },
  { value: 'DUPLICATE_OF', label: 'Duplicate of' },
  { value: 'PARENT_OF', label: 'Parent of' },
  { value: 'CHILD_OF', label: 'Child of' },
  { value: 'CONVERTED_FROM', label: 'Converted from' },
]

export function TicketRelationships({ ticket }: TicketProps) {
  const [isAddRelationOpen, setIsAddRelationOpen] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [relationType, setRelationType] = useState<string>('RELATED')

  // Get all tickets for selection
  const { data: allTicketsData } = api.ticket.all.useQuery({})

  // Filter out the current ticket and already related tickets
  const availableTickets = (allTicketsData?.tickets || []).filter(
    (t) => t.id !== ticket.id && !ticket.relatedTickets.some((r) => r.relatedTicketId === t.id)
  )

  // Mutation to add a relation
  const addRelationMutation = api.ticket.addRelation.useMutation({
    onSuccess: () => {
      setIsAddRelationOpen(false)
      setSelectedTicketId(null)
      // Refetch ticket data
      refetch()
    },
  })

  // Mutation to remove a relation
  const removeRelationMutation = api.ticket.removeRelation.useMutation({
    onSuccess: () => {
      // Refetch ticket data
      refetch()
    },
  })

  // Get source and related tickets
  const { refetch } = api.ticket.byId.useQuery(
    { id: ticket.id },
    { refetchOnWindowFocus: false, retry: 1 }
  )

  const handleAddRelation = async () => {
    if (!selectedTicketId) return

    await addRelationMutation.mutateAsync({
      ticketId: ticket.id,
      relatedTicketId: selectedTicketId,
      relation: relationType,
    })
  }

  const handleRemoveRelation = async (relationId: string) => {
    await removeRelationMutation.mutateAsync({ relationId })
  }

  // Utility to get relation label
  const getRelationLabel = (relation: string) => {
    return RELATION_TYPES.find((t) => t.value === relation)?.label || relation
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Related Tickets</CardTitle>
          <Button variant="outline" size="xs" onClick={() => setIsAddRelationOpen(true)}>
            <Plus className="mr-1 h-3 w-3" /> Link
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {ticket.relatedTickets.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">No related tickets</div>
        ) : (
          <div className="divide-y">
            {ticket.relatedTickets.map((relation) => (
              <div
                key={relation.id}
                className="flex items-center justify-between px-4 py-2 hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    {getRelationLabel(relation.relation)}
                  </Badge>
                  <Link
                    href={`/app/tickets/${relation.relatedTicket.id}`}
                    className="flex items-center text-sm hover:underline">
                    {relation.relatedTicket.number}
                    <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {relation.relatedTicket.status}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => handleRemoveRelation(relation.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Dialog for adding a relation */}
      <Dialog open={isAddRelationOpen} onOpenChange={setIsAddRelationOpen}>
        <DialogContent size="sm">
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
              <Command className="rounded-md border">
                <CommandInput placeholder="Search tickets..." />
                <CommandList>
                  <CommandEmpty>No tickets found.</CommandEmpty>
                  <CommandGroup>
                    {availableTickets.map((t) => (
                      <CommandItem
                        key={t.id}
                        value={t.id}
                        onSelect={() => setSelectedTicketId(t.id)}
                        className={cn(
                          'flex items-center justify-between',
                          selectedTicketId === t.id && 'bg-accent'
                        )}>
                        <div>
                          <span className="mr-2 font-mono text-xs text-muted-foreground">
                            {t.number}
                          </span>
                          <span>{t.title}</span>
                        </div>
                        {selectedTicketId === t.id && <span className="text-blue-500">✓</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsAddRelationOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddRelation}
              disabled={!selectedTicketId || addRelationMutation.isPending}
              loading={addRelationMutation.isPending}
              loadingText="Adding...">
              Add Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
