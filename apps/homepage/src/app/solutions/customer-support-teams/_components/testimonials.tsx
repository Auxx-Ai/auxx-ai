// apps/web/src/app/(website)/solutions/customer-support-teams/_components/testimonials.tsx
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
                    TechCorp's support team leveraged Auxx.ai to transform their customer service
                    operations,{' '}
                    <strong className="text-foreground">
                      resulting in a 60% reduction in escalations and 50% increase in agent
                      productivity.
                    </strong>
                  </p>
                  <div className="row-span-2 grid grid-rows-subgrid gap-8 border-t pt-8">
                    <p className='text-foreground self-end text-balance before:mr-1 before:content-["\201C"] after:ml-1 after:content-["\201D"]'>
                      Auxx.ai transformed our support workflow. Our agents went from drowning in
                      repetitive tickets to focusing on complex customer issues. Agent satisfaction
                      increased 50% and we're handling 3x more tickets with the same team size.
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="ring-foreground/10 aspect-square size-10 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1">
                        <img
                          src={avatars.luis}
                          alt="Luis's avatar"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="space-y-px">
                        <p className="text-sm font-medium">Luis V.</p>
                        <p className="text-muted-foreground text-xs">Support Team Lead, TechCorp</p>
                      </div>
                    </div>
                  </div>
                </Card>
                <Card className="bg-linear-to-b row-span-5 grid grid-rows-subgrid gap-8 from-blue-50 p-8">
                  <p className="text-muted-foreground self-end text-balance text-xl font-medium">
                    GlobalTech's customer support team utilized Auxx.ai's AI assistance to{' '}
                    <strong className="text-foreground">
                      reduce response time by 80% while handling 10K+ monthly tickets
                    </strong>{' '}
                    with intelligent automation and seamless agent handoffs.
                  </p>

                  <div className="row-span-2 grid grid-rows-subgrid gap-8 border-t pt-8">
                    <p className='text-foreground text-balance before:mr-1 before:content-["\201C"] after:ml-1 after:content-["\201D"]'>
                      The AI integration was seamless. Within hours, our support agents had an AI
                      co-pilot handling routine tasks, suggesting responses, and escalating complex
                      issues. The system empowers our team to handle 10K tickets effortlessly.
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="ring-foreground/10 aspect-square size-10 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1">
                        <img
                          src={avatars.calvin}
                          alt="Calvin Ochoa's avatar"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="space-y-px">
                        <p className="text-sm font-medium">Calvin Ochoa</p>
                        <p className="text-muted-foreground text-xs">
                          Customer Support Director, GlobalTech
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
