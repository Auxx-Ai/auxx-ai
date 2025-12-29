import React from 'react'
import TicketForm from '../../_components/ticket-form'
import { api } from '~/trpc/server'
import { Separator } from '@auxx/ui/components/separator'
import { Tooltip } from '~/components/global/tooltip'
import { Button } from '@auxx/ui/components/button'
import { ArrowLeft } from 'lucide-react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
// import NewTicketForm from '../../_components/new-ticket-form'

type Props = { params: Promise<{ ticketId: string }> }

async function TicketEditPage({ params }: Props) {
  const { ticketId } = await params

  const ticket = await api.ticket.byId({ id: ticketId })

  return (
    <div className="">
      <div className="flex items-center p-4">
        <h1 className="text-2xl font-bold">Edit Ticket</h1>
      </div>
      <div>
        <Separator className="" />
        <div className="flex items-center bg-slate-50 p-2 dark:bg-black">
          <div className="flex items-center gap-2">
            <Tooltip content="Go Back">
              <Button variant="outline" size="sm" className="px-2" asChild>
                <Link href={`/app/tickets/${ticketId}`}>
                  <ArrowLeft />
                  Back
                </Link>
              </Button>
            </Tooltip>

            {/* <span className='text-xs text-muted-foreground'>df</span> */}
          </div>
        </div>
        <Separator className="" />
      </div>
      <div className="h-[calc(100vh-114px)] overflow-y-auto">
        <div className="container mx-auto mb-10 mt-8">
          <TicketForm isEditing ticket={ticket} />
        </div>
      </div>
    </div>
  )
}

export default TicketEditPage
