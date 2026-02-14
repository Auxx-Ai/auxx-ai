// apps/homepage/src/app/platform/ticketing/_components/ticket-center-section.tsx
import Image from 'next/image'

/**
 * TicketCenterSection component displays the ticketing system interface
 * with description of ticket management and automation capabilities
 */
export default function TicketCenterSection() {
  return (
    <section className='relative bg-background border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Manage every conversation in{' '}
                <strong className='text-foreground font-semibold'>one unified inbox</strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <Image
                  src='/images/platform/ticketing/tickets.png'
                  width={3070}
                  height={1994}
                  alt='Ticketing system interface showing organized customer support tickets'
                  className='h-full w-full object-cover'
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Every email becomes a ticket with{' '}
                  <strong className='text-foreground font-semibold'>
                    AI-powered triage and categorization
                  </strong>
                  . Automatically tag, prioritize, and route tickets based on content, sentiment,
                  and customer context so your team focuses on what matters most.
                </p>

                <p className='text-muted-foreground'>
                  Track ticket status, response times, and resolution metrics in real-time.{' '}
                  <strong className='text-foreground font-semibold'>
                    Collaborate with your team
                  </strong>{' '}
                  using internal notes, assignments, and status updates—all without leaving the
                  inbox.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
