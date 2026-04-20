// apps/homepage/src/app/platform/crm/_components/how-it-works-section.tsx

import {
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Flag,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Play,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { config } from '@/lib/config'
import Gmail from '~/components/logos/gmail'
import Outlook from '~/components/logos/outlook'
import Shopify from '~/components/logos/shopify'
import { Button } from '~/components/ui/button'

const { urls } = config

/**
 * How It Works section showing the 3-step process
 */
export default function HowItWorksSection() {
  const steps = [
    {
      number: '01',
      title: 'Connect Your Tools',
      subtitle: 'Link Email & Shopify',
      description:
        'Connect Gmail/Outlook and Shopify in 60 seconds. No coding required. Our secure OAuth integration ensures your data stays protected.',
      icon: <Link2 className='h-6 w-6' />,
      features: [
        'One-click Gmail/Outlook connection',
        'Instant Shopify store sync',
        'Secure OAuth 2.0 authentication',
      ],
      visual: (
        <div aria-hidden className='mask-b-from-65% w-full  pt-1'>
          <div className='bg-card/75 ring-border-illustration shadow-black/6.5 rounded-t-2xl p-2 shadow-lg ring-1'>
            <div className='px-3 py-2 text-sm font-medium'>Connect Integration</div>

            <div className='bg-background ring-border-illustration space-y-3 rounded-2xl p-3 ring-1'>
              <div className='bg-illustration ring-primary/40 shadow-primary/10 group cursor-pointer rounded-lg p-3 shadow-md ring-1 transition-all'>
                <div className='flex items-start justify-between gap-3'>
                  <Gmail className='size-5 shrink-0' />
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <div className='text-sm font-semibold'>Gmail</div>
                      <div className='bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium'>
                        Recommended
                      </div>
                    </div>
                    <div className='text-muted-foreground mt-1 text-xs'>support@yourstore.com</div>
                  </div>
                  <Check className='text-primary size-4 shrink-0' />
                </div>
              </div>

              <div className='hover:ring-border-illustration/80 bg-illustration ring-border-illustration hover:bg-foreground/5 group cursor-pointer rounded-lg p-3 ring-1 transition-all'>
                <div className='flex items-start justify-between gap-3'>
                  <Outlook className='size-5 shrink-0' />
                  <div className='flex-1'>
                    <div className='text-sm font-semibold'>Outlook</div>
                    <div className='text-muted-foreground mt-1 text-xs'>
                      Microsoft 365 & Outlook.com
                    </div>
                  </div>
                </div>
              </div>

              <div className='hover:ring-border-illustration/80 bg-illustration ring-border-illustration hover:bg-foreground/5 group cursor-pointer rounded-lg p-3 ring-1 transition-all'>
                <div className='flex items-start justify-between gap-3'>
                  <Shopify className='size-5 shrink-0 text-[#95BF46]' />
                  <div className='flex-1'>
                    <div className='text-sm font-semibold'>Shopify</div>
                    <div className='text-muted-foreground mt-1 text-xs'>
                      yourstore.myshopify.com
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <button
              type='button'
              className='hover:bg-muted border-border mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors'>
              <span>View all integrations</span>
              <ChevronDown className='size-3' />
            </button>
          </div>
        </div>
      ),
    },
    {
      number: '02',
      title: 'Train Your AI',
      subtitle: 'AI Learns Your Business',
      description:
        'Import FAQs, policies, and past tickets. AI understands your specific products, processes, and brand voice within minutes.',
      icon: <Brain className='h-6 w-6' />,
      features: [
        'Import existing knowledge base',
        'Learn from historical tickets',
        'Custom business rules',
      ],
      visual: (
        <div aria-hidden className='mask-b-from-65% w-full pt-1'>
          <div className='bg-card/75 ring-border-illustration shadow-black/6.5 rounded-2xl p-6 shadow-lg ring-1'>
            <div className='flex items-center gap-2'>
              <div className='text-sm font-medium'>Training Plan</div>
              <div className='bg-primary/10 text-primary ml-auto rounded px-2 py-0.5 text-[10px]'>
                Auto-generated
              </div>
            </div>

            <div className='mt-4 space-y-2'>
              <div className='flex items-start gap-2'>
                <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-green-500' />
                <div className='flex-1'>
                  <div className='text-xs font-medium line-through opacity-50'>1. Import FAQs</div>
                  <div className='text-muted-foreground text-[10px]'>Completed in 3.2s</div>
                </div>
              </div>

              <div className='flex items-start gap-2'>
                <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-green-500' />
                <div className='flex-1'>
                  <div className='text-xs font-medium line-through opacity-50'>
                    2. Learn return policies
                  </div>
                  <div className='text-muted-foreground text-[10px]'>Completed in 6.4s</div>
                </div>
              </div>

              <div className='bg-primary/5 ring-primary/20 -mx-2 flex items-start gap-2 rounded-lg p-2 ring-1'>
                <div className='relative mt-0.5'>
                  <CircleDashed
                    className='text-primary size-4 animate-spin'
                    style={{ animationDuration: '3s' }}
                  />
                  <Play className='text-primary absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-current' />
                </div>
                <div className='flex-1'>
                  <div className='text-primary text-xs font-semibold'>3. Analyze past tickets</div>
                  <div className='text-primary/70 text-[10px]'>In progress... 18s</div>
                </div>
              </div>

              <div className='flex items-start gap-2 opacity-40'>
                <CircleDashed className='text-muted-foreground mt-0.5 size-4 shrink-0' />
                <div className='flex-1'>
                  <div className='text-xs font-medium'>4. Train brand voice</div>
                  <div className='text-muted-foreground text-[10px]'>Pending</div>
                </div>
              </div>

              <div className='flex items-start gap-2 opacity-40'>
                <CircleDashed className='text-muted-foreground mt-0.5 size-4 shrink-0' />
                <div className='flex-1'>
                  <div className='text-xs font-medium'>5. Validate responses</div>
                  <div className='text-muted-foreground text-[10px]'>Pending</div>
                </div>
              </div>
            </div>

            <div className='mt-3 flex items-center justify-between text-[10px]'>
              <div className='text-muted-foreground'>2/5 steps complete</div>
              <div className='text-muted-foreground'>Est. 2 min remaining</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      number: '03',
      title: 'Activate Automation',
      subtitle: 'Watch Magic Happen',
      description:
        'AI drafts responses, you review and approve. Or go full auto-pilot for common queries. See results in real-time.',
      icon: <Zap className='h-6 w-6' />,
      features: [
        'Real-time response generation',
        'Human review option',
        'Auto-pilot for simple queries',
      ],
      visual: (
        <div
          aria-hidden
          className='mask-radial-[100%_100%] mask-radial-from-75% mask-radial-at-top-left pr-3 pt-1'>
          <div className='bg-card/50 ring-border-illustration shadow-black/6.5 w-full rounded-2xl p-2 shadow-xl ring-1'>
            <div className='mb-2 flex items-center justify-between px-2 pt-1'>
              <div className='flex items-center gap-2'>
                <div className='size-2 rounded-full bg-amber-500' />
                <span className='text-sm font-semibold'>Live Tickets</span>
              </div>
              <MoreHorizontal className='text-muted-foreground size-4' />
            </div>

            <div className='space-y-2 *:rounded-lg'>
              <div className='bg-illustration shadow-black/6.5 ring-border-illustration p-3 shadow ring-1'>
                <div className='mb-2 flex items-start justify-between'>
                  <div className='text-sm font-medium'>Order #1042 refund</div>
                  <Flag className='size-3.5 fill-red-500 text-red-500' />
                </div>
                <p className='text-muted-foreground mb-3 text-xs'>
                  AI drafting reply with refund policy
                </p>
                <div className='flex items-center justify-between'>
                  <div className='flex -space-x-1.5'>
                    <div className='bg-primary/15 text-primary ring-card flex size-5 items-center justify-center rounded-full text-[9px] font-medium ring-2'>
                      AI
                    </div>
                    <div className='bg-blue-500/15 text-blue-500 ring-card flex size-5 items-center justify-center rounded-full text-[9px] font-medium ring-2'>
                      JD
                    </div>
                  </div>
                  <div className='text-muted-foreground flex items-center gap-2 text-[10px]'>
                    <span className='flex items-center gap-0.5'>
                      <MessageSquare className='size-3' />4
                    </span>
                    <span className='flex items-center gap-0.5'>
                      <Paperclip className='size-3' />2
                    </span>
                  </div>
                </div>
              </div>

              <div className='bg-illustration shadow-black/6.5 ring-border-illustration p-3 shadow ring-1'>
                <div className='mb-2 flex items-start justify-between'>
                  <div className='text-sm font-medium'>Shipping delay inquiry</div>
                  <Flag className='size-3.5 fill-amber-500 text-amber-500' />
                </div>
                <p className='text-muted-foreground mb-3 text-xs'>
                  Awaiting your review before sending
                </p>
                <div className='flex items-center justify-between'>
                  <div className='flex -space-x-1.5'>
                    <div className='bg-primary/15 text-primary ring-card flex size-5 items-center justify-center rounded-full text-[9px] font-medium ring-2'>
                      AI
                    </div>
                  </div>
                  <div className='text-muted-foreground flex items-center gap-2 text-[10px]'>
                    <span className='flex items-center gap-0.5'>
                      <MessageSquare className='size-3' />2
                    </span>
                  </div>
                </div>
              </div>

              <div className='bg-illustration shadow-black/6.5 ring-border-illustration p-3 shadow ring-1'>
                <div className='mb-2 flex items-start justify-between'>
                  <div className='text-sm font-medium'>Product sizing question</div>
                  <Flag className='text-muted-foreground size-3.5' />
                </div>
                <p className='text-muted-foreground mb-3 text-xs'>Auto-replied with sizing guide</p>
                <div className='flex items-center justify-between'>
                  <div className='flex -space-x-1.5'>
                    <div className='bg-primary/15 text-primary ring-card flex size-5 items-center justify-center rounded-full text-[9px] font-medium ring-2'>
                      AI
                    </div>
                  </div>
                  <div className='text-muted-foreground flex items-center gap-2 text-[10px]'>
                    <span className='flex items-center gap-0.5'>
                      <Paperclip className='size-3' />1
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ]

  return (
    <section className='relative border-foreground/10 border-b bg-muted/30'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-black),var(--color-black)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='py-16 md:py-24 px-6'>
            <div className='text-center mb-12 md:mb-16'>
              <h2 className='text-3xl md:text-4xl font-bold text-foreground mb-4'>
                From Email to Answer in 3 Simple Steps
              </h2>
              <p className='text-lg text-muted-foreground max-w-2xl mx-auto'>
                Get started in minutes, not weeks. No technical expertise required.
              </p>
            </div>

            <div className='grid md:grid-cols-3 gap-8 lg:gap-12'>
              {steps.map((step, index) => (
                <div key={index} className='relative'>
                  {/* Connection line */}

                  <div className='space-y-6'>
                    {/* Step number and icon */}
                    <div className='flex items-center gap-4'>
                      <div className='relative'>
                        <div className='text-4xl font-bold text-muted-foreground/30'>
                          {step.number}
                        </div>
                      </div>
                      {/* <div className='p-3 rounded-lg bg-primary/10 text-primary'>{step.icon}</div> */}
                    </div>

                    {/* Content */}
                    <div className='space-y-4'>
                      <div>
                        <h3 className='text-xl font-semibold text-foreground mb-1'>{step.title}</h3>
                        <p className='text-sm font-medium text-primary/50'>{step.subtitle}</p>
                      </div>
                      <p className='text-muted-foreground text-sm leading-relaxed hidden'>
                        {step.description}
                      </p>

                      {/* Features list */}
                      <ul className='space-y-2'>
                        {step.features.map((feature, i) => (
                          <li key={i} className='flex items-center gap-2 text-sm'>
                            <CheckCircle2 className='h-4 w-4 text-green-500 shrink-0' />
                            <span className='text-muted-foreground'>{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Visual representation */}
                      <div className='sm:mt-8 pt-6'>{step.visual}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className='mt-16 text-center'>
              <div className='inline-flex flex-col sm:flex-row items-center gap-4'>
                <Button asChild size='lg' className='bg-accent' variant='outline'>
                  <Link href={urls.signup}>
                    Get started
                    <ArrowRight />
                  </Link>
                </Button>
                <span className=''>or</span>
                <span className='text-sm text-muted-foreground'>
                  <Link href={urls.demo} className='text-info hover:underline italic'>
                    request a demo
                  </Link>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
