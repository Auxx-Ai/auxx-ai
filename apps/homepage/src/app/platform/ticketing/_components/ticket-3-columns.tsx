// apps/homepage/src/app/platform/ticketing/_components/ticket-3-columns.tsx
import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

/**
 * Ticket3Columns component showcases three key ticketing features:
 * dashboard overview, ticket detail view, and ticket merging capabilities
 */
export default function Ticket3Columns() {
  return (
    <section className="relative bg-background border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div className="bg-muted/50 @container py-16 md:py-24">
            <div className="mx-auto max-w-5xl px-6">
              <h2 className="text-muted-foreground text-balance text-4xl font-semibold md:w-2/3">
                Everything you need to{' '}
                <strong className="text-foreground font-semibold">
                  manage customer support at scale
                </strong>
              </h2>
              <div className="@3xl:grid-cols-3 @xl:grid-cols-2 mt-12 grid gap-6">
                <div className="row-span-4 grid grid-rows-subgrid gap-4">
                  <div className="bg-background ring-foreground/5 aspect-square rounded-xl border border-transparent shadow ring-1">
                    <Image
                      src="/images/platform/ticketing/ticket-col1-dashboard.png"
                      alt="Ticket dashboard showing overview of support tickets"
                      width={2608}
                      height={1882}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <h3 className="text-muted-foreground text-sm">Dashboard Overview</h3>
                  <p className="text-muted-foreground">
                    Get a{' '}
                    <strong className="text-foreground font-semibold">
                      bird's-eye view of all tickets
                    </strong>{' '}
                    with real-time status updates, priority levels, and team assignments at a
                    glance.
                  </p>
                </div>
                <div className="row-span-4 grid grid-rows-subgrid gap-4">
                  <div className="bg-background ring-foreground/5 aspect-square rounded-xl border border-transparent shadow ring-1">
                    <Image
                      src="/images/platform/ticketing/ticket-col2-view.png"
                      alt="Detailed ticket view with customer context"
                      width="1946"
                      height="1680"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <h3 className="text-muted-foreground text-sm">Detailed Ticket View</h3>
                  <p className="text-muted-foreground">
                    See{' '}
                    <strong className="text-foreground font-semibold">
                      full conversation history and customer context
                    </strong>{' '}
                    including order details, past tickets, and AI-suggested responses in one place.
                  </p>
                </div>
                <div className="row-span-4 grid grid-rows-subgrid gap-4">
                  <div className="bg-background ring-foreground/5 aspect-square overflow-hidden rounded-xl border border-transparent shadow ring-1">
                    <Image
                      src="/images/platform/ticketing/ticket-col3-merge.png"
                      alt="Ticket merging interface combining duplicate conversations"
                      width="1000"
                      height="740"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <h3 className="text-muted-foreground text-sm">Smart Ticket Merging</h3>
                  <p className="text-muted-foreground">
                    <strong className="text-foreground font-semibold">
                      Automatically detect and merge duplicate tickets
                    </strong>{' '}
                    from the same customer to maintain a clean, organized inbox and complete
                    conversation history.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
