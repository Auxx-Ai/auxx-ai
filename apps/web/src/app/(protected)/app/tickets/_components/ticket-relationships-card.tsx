// apps/web/src/app/(protected)/app/tickets/_components/ticket-relationships-card.tsx
'use client'

import { useState } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ArrowUpRight, Link as LinkIcon, X } from 'lucide-react'
import Link from 'next/link'
import { api } from '~/trpc/react'
import { TicketLinkDialog } from './ticket-link-dialog'
import type { Ticket } from './ticket-types'

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
 * Props for TicketRelationshipsCard component
 */
interface TicketRelationshipsCardProps {
  ticketId: string
  className?: string
}

/**
 * TicketRelationshipsCard component - displays related tickets with ability to add/remove links
 */
export function TicketRelationshipsCard({ ticketId, className }: TicketRelationshipsCardProps) {
  const [isAddLinkOpen, setIsAddLinkOpen] = useState(false)

  // Fetch ticket data with relationships
  const { data: ticket, refetch } = api.ticket.byId.useQuery(
    { id: ticketId },
    { refetchOnWindowFocus: false, retry: 1 }
  )

  // Mutation to remove a relation
  const removeRelationMutation = api.ticket.removeRelation.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  /**
   * Handle removing a relation
   */
  const handleRemoveRelation = async (relationId: string) => {
    await removeRelationMutation.mutateAsync({ relationId })
  }

  /**
   * Get relation label from value
   */
  const getRelationLabel = (relation: string) => {
    return RELATION_TYPES.find((t) => t.value === relation)?.label || relation
  }

  if (!ticket) return null

  const relatedTicketIds = ticket.relatedTickets.map((r) => r.relatedTicketId)

  return (
    <div className={className}>
      {ticket.relatedTickets.length === 0 ? (
        <div className="bg-primary-100/50 rounded-2xl border py-3 px-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LinkIcon className="size-4" />
              <span>No related tickets</span>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setIsAddLinkOpen(true)}
              className="shrink-0">
              <LinkIcon className="size-3" />
              Link
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {ticket.relatedTickets.map((relation) => (
            <div
              key={relation.id}
              className="group flex items-center justify-between bg-primary-100/50 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200">
              <div className="flex items-center gap-3">
                <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
                  <LinkIcon className="size-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" size="xs" className="font-normal">
                      {getRelationLabel(relation.relation)}
                    </Badge>
                    <Link
                      href={`/app/tickets/${relation.relatedTicket.id}`}
                      className="text-sm font-medium hover:underline inline-flex items-center gap-1">
                      #{relation.relatedTicket.number}
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {relation.relatedTicket.title}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemoveRelation(relation.id)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddLinkOpen(true)}
            className="w-full border-dashed">
            <LinkIcon className="size-4" />
            Link another ticket
          </Button>
        </div>
      )}

      <TicketLinkDialog
        ticketId={ticketId}
        relatedTicketIds={relatedTicketIds}
        open={isAddLinkOpen}
        onOpenChange={setIsAddLinkOpen}
        onSuccess={() => refetch()}
      />
    </div>
  )
}
