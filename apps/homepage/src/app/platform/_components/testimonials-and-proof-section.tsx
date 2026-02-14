// apps/web/src/app/(website)/features/_components/sections/testimonials-and-proof-section.tsx

import { Quote } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'
import { cn } from '~/lib/utils'

// Enumerates customer testimonials for the social proof section.
const testimonials = [
  {
    quote:
      'Auxx.ai automated 75% of our support volume within the first month. The Shopify workflows are unlike anything else we evaluated.',
    name: 'Maya Chen',
    role: 'Director of CX, Lunar Labs',
    color: 'text-indigo-500',
    bgColor: 'bg-linear-to-b from-indigo-50',
  },
  {
    quote:
      'We cut response times from hours to minutes while keeping CSAT at all-time highs. Auxx.ai feels like an extra teammate.',
    name: 'Diego Ramirez',
    color: 'text-cyan-500',
    role: 'Head of Support, Mercado Moda',
    bgColor: 'bg-linear-to-b from-cyan-50',
  },
  {
    quote:
      'Security reviews passed on the first attempt thanks to Auxx.ai’s detailed documentation and compliance posture.',
    name: 'Elena Patel',
    color: 'text-amber-500',
    role: 'VP of Operations, Northwind Traders',
    bgColor: 'bg-linear-to-b from-amber-50',
  },
]

// Lists security certifications showcased as logos in the proof section.
const certificationLogos = ['SOC 2', 'ISO 27001', 'GDPR', 'PCI DSS', 'HIPAA Ready']

// Renders the testimonials carousel and supporting trust badges.
export function TestimonialsAndProofSection() {
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='w-full px-6 py-24'>
            <div className='mb-10 flex flex-col gap-4 text-center'>
              <Badge variant='outline' className='mx-auto w-fit'>
                Customer results
              </Badge>
              <h2 className='text-pretty text-3xl font-semibold sm:text-4xl'>
                Trusted by high-volume Shopify brands worldwide
              </h2>
              <p className='text-muted-foreground mx-auto max-w-3xl text-base'>
                From DTC pioneers to global retailers, Auxx.ai powers support teams that demand
                accuracy, compliance, and immediate ROI.
              </p>
            </div>
            <div className='grid gap-6 md:grid-cols-3'>
              {testimonials.map((testimonial) => (
                <Card
                  key={testimonial.name}
                  className={cn(
                    ' ring-foreground/10 flex h-full flex-col gap-4 rounded-3xl border p-6 shadow-lg',
                    testimonial.bgColor
                  )}>
                  <Quote className={cn('size-6 ', testimonial.color)} />
                  <p className='text-sm text-muted-foreground'>{testimonial.quote}</p>
                  <div className='mt-auto pt-4 text-sm'>
                    <div className='font-semibold text-foreground'>{testimonial.name}</div>
                    <div className='text-muted-foreground text-xs'>{testimonial.role}</div>
                  </div>
                </Card>
              ))}
            </div>

            {/* <div className="mt-12 flex flex-wrap items-center justify-center gap-4 rounded-3xl border border-border/60 bg-muted/40 px-6 py-5">
              <ShieldCheck className="size-5 text-indigo-500" />
              {certificationLogos.map((certification) => (
                <span
                  key={certification}
                  className="rounded-full border border-border/60 bg-background/80 px-4 py-2 text-xs font-medium text-muted-foreground">
                  {certification}
                </span>
              ))}
            </div> */}
          </div>
        </div>
      </div>
    </section>
  )
}
