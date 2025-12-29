// apps/web/src/app/(website)/solutions/shopify-stores/_components/testimonials.tsx
import { Card } from '~/components/ui/card'
import { avatars } from '~/app/_components/avatars'

export default function TestimonialsSection() {
  return (
    <section className="bg-linear-to-b from-background to-muted relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div className=" @container py-16 lg:py-24">
            <div className="mx-auto max-w-5xl px-6">
              <div className="*:ring-foreground/10 @4xl:grid-cols-2 grid gap-6 *:shadow-lg">
                <Card className="bg-linear-to-b row-span-5 grid grid-rows-subgrid gap-8 from-purple-50 p-8">
                  <p className="text-muted-foreground text-balance text-xl font-medium">
                    Legacy CivilWorks leveraged Auxx.ai to transform their customer support
                    operations,{' '}
                    <strong className="text-foreground">
                      resulting in an 82% reduction in support tickets and 40% increase in CSAT
                      scores.
                    </strong>
                  </p>
                  <div className="row-span-2 grid grid-rows-subgrid gap-8 border-t pt-8">
                    <p className='text-foreground self-end text-balance before:mr-1 before:content-["\201C"] after:ml-1 after:content-["\201D"]'>
                      Auxx.ai transformed our support operation. We went from drowning in tickets to
                      proactively delighting customers. Our CSAT scores increased 40% in the first
                      month, and we're handling 15K+ monthly orders effortlessly.
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="ring-foreground/10 aspect-square size-10 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1">
                        <img
                          src={avatars.adriana}
                          alt="Adriana Klooth's avatar"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="space-y-px">
                        <p className="text-sm font-medium">Adriana Klooth</p>
                        <p className="text-muted-foreground text-xs">
                          Project Manager, Legacy CivilWorks Engineering, Inc
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
                <Card className="bg-linear-to-b row-span-5 grid grid-rows-subgrid gap-8 from-blue-50 p-8">
                  <p className="text-muted-foreground self-end text-balance text-xl font-medium">
                    RMD Kwikform utilized Auxx.ai's Shopify integration to{' '}
                    <strong className="text-foreground">
                      reduce support tickets by 67% while handling 8K+ monthly orders
                    </strong>{' '}
                    with seamless automated responses and upselling capabilities.
                  </p>

                  <div className="row-span-2 grid grid-rows-subgrid gap-8 border-t pt-8">
                    <p className='text-foreground text-balance before:mr-1 before:content-["\201C"] after:ml-1 after:content-["\201D"]'>
                      The Shopify integration was seamless. Within hours, our AI was handling order
                      status inquiries, processing returns, and even upselling complementary
                      products. The system handles our 8K monthly orders without breaking a sweat.
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="ring-foreground/10 aspect-square size-10 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1">
                        <img
                          src={avatars.zach}
                          alt="Zachery Melton's avatar"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="space-y-px">
                        <p className="text-sm font-medium">Zachery Melton</p>
                        <p className="text-muted-foreground text-xs">
                          Operations Director, RMD Kwikform
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
