// apps/web/src/app/(website)/solutions/customer-support-teams/_components/testimonials.tsx

import { avatars } from '~/app/_components/avatars'
import { Card } from '~/components/ui/card'

export default function TestimonialsSection() {
  return (
    <section className='bg-linear-to-b from-background to-muted relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className=' @container py-16 lg:py-24'>
            <div className='mx-auto max-w-5xl px-6'>
              <div className='*:ring-foreground/10 @4xl:grid-cols-2 grid gap-6 *:shadow-lg'>
                <Card className='bg-linear-to-b row-span-5 grid grid-rows-subgrid gap-8 from-purple-50 p-8'>
                  <p className='text-muted-foreground text-balance text-xl font-medium'>
                    Bright Consulting leveraged Auxx.ai to transform their small business
                    operations,{' '}
                    <strong className='text-foreground'>
                      resulting in an 85% reduction in support tickets and 45% increase in client
                      satisfaction.
                    </strong>
                  </p>
                  <div className='row-span-2 grid grid-rows-subgrid gap-8 border-t pt-8'>
                    <p className='text-foreground self-end text-balance before:mr-1 before:content-["\201C"] after:ml-1 after:content-["\201D"]'>
                      Auxx.ai transformed our client support. We went from being overwhelmed by
                      inquiries to providing instant, personalized responses. Our client
                      satisfaction increased 45% in the first month, and we're serving 200+ clients
                      seamlessly.
                    </p>
                    <div className='flex items-center gap-3'>
                      <div className='ring-foreground/10 aspect-square size-10 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1'>
                        <img
                          src={avatars.danielle}
                          alt="Danielle's avatar"
                          className='h-full w-full object-cover'
                        />
                      </div>
                      <div className='space-y-px'>
                        <p className='text-sm font-medium'>Danielle K.</p>
                        <p className='text-muted-foreground text-xs'>
                          Operations Manager, Bright Consulting
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
                <Card className='bg-linear-to-b row-span-5 grid grid-rows-subgrid gap-8 from-blue-50 p-8'>
                  <p className='text-muted-foreground self-end text-balance text-xl font-medium'>
                    Local Services Co utilized Auxx.ai's business integration to{' '}
                    <strong className='text-foreground'>
                      reduce support tickets by 70% while managing 500+ monthly inquiries
                    </strong>{' '}
                    with seamless automated responses and intelligent routing capabilities.
                  </p>

                  <div className='row-span-2 grid grid-rows-subgrid gap-8 border-t pt-8'>
                    <p className='text-foreground text-balance before:mr-1 before:content-["\201C"] after:ml-1 after:content-["\201D"]'>
                      The business integration was seamless. Within hours, our AI was handling
                      appointment bookings, answering FAQs, and routing complex inquiries to the
                      right team member. The system handles our 500 monthly inquiries effortlessly.
                    </p>
                    <div className='flex items-center gap-3'>
                      <div className='ring-foreground/10 aspect-square size-10 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1'>
                        <img
                          src={avatars.vicken}
                          alt="Vicken D's avatar"
                          className='h-full w-full object-cover'
                        />
                      </div>
                      <div className='space-y-px'>
                        <p className='text-sm font-medium'>Vicken D.</p>
                        <p className='text-muted-foreground text-xs'>
                          Business Owner, Local Services Co
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
