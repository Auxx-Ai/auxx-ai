// apps/homepage/src/app/_components/sections/pricing-section.tsx
'use client'
import NumberFlow from '@number-flow/react'
import { Check } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { CardDescription, CardTitle } from '~/components/ui/card'
import { useConfig } from '~/lib/config-context'
import { cn } from '~/lib/utils'

// PricingSection renders the pricing plans selector and cards.
export default function PricingSection() {
  const { urls, emails } = useConfig()
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annually'>('annually')
  const annualDiscount = 0.3

  const prices = {
    starter: {
      monthly: 20,
      annually: 20 * (1 - annualDiscount),
    },
    growth: {
      monthly: 50,
      annually: 50 * (1 - annualDiscount),
    },
  }

  return (
    <>
      <section className='pt-30 pb-16 border-b'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-3xl font-bold md:text-4xl lg:text-5xl lg:tracking-tight'>
            Pricing that scales with your business
          </h2>
          <p className='text-muted-foreground mx-auto mt-4 max-w-xl text-balance text-lg'>
            Choose the perfect plan for your team and start automating your support today
          </p>
        </div>
      </section>
      <section className='relative border-foreground/10 border-b'>
        <div className='relative z-10 mx-auto max-w-6xl border-foreground/10 border-x px-3'>
          <div className='border-foreground/10 border-x'>
            <div
              aria-hidden
              className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
            />
            <div className='bg-muted/50 relative pt-8 md:pt-12 pb-16 md:pb-32'>
              <div className='mx-auto max-w-5xl px-6'>
                <div className='mx-auto max-w-2xl text-center'>
                  <div className='mb-12'>
                    <div
                      data-period={billingPeriod}
                      className='bg-foreground/5 *:text-foreground/75 relative mx-auto grid w-fit grid-cols-2 rounded-full p-1 *:block *:h-8 *:w-24 *:rounded-full *:text-sm *:hover:opacity-75'>
                      <div
                        aria-hidden
                        className='bg-card in-data-[period=monthly]:translate-x-0 ring-foreground/5 pointer-events-none absolute inset-1 w-1/2 translate-x-full rounded-full border border-transparent shadow ring-1 transition-transform duration-500 ease-in-out'
                      />
                      <button
                        onClick={() => setBillingPeriod('monthly')}
                        {...(billingPeriod === 'monthly' && { 'data-active': true })}
                        className='data-active:text-foreground data-active:font-medium relative'>
                        Monthly
                      </button>
                      <button
                        onClick={() => setBillingPeriod('annually')}
                        {...(billingPeriod === 'annually' && { 'data-active': true })}
                        className='data-active:text-foreground data-active:font-medium relative'>
                        Annually
                      </button>
                    </div>
                    <div className='mt-3 text-center text-xs'>
                      <span className='text-info font-medium'>Save 30%</span> On Annual Billing
                    </div>
                  </div>
                </div>

                <div className='@container'>
                  <div className='@max-4xl:max-w-sm relative mx-auto border'>
                    <PlusDecorator className='-translate-[calc(50%+0.5px)]' />
                    <PlusDecorator className='right-0 -translate-y-[calc(50%+0.5px)] translate-x-[calc(50%+0.5px)]' />
                    <PlusDecorator className='bottom-0 right-0 translate-x-[calc(50%+0.5px)] translate-y-[calc(50%+0.5px)]' />
                    <PlusDecorator className='bottom-0 -translate-x-[calc(50%+0.5px)] translate-y-[calc(50%+0.5px)]' />
                    <div className='relative mx-auto border-b'>
                      <PlusDecorator className='bottom-0 -translate-x-[calc(50%+0.5px)] translate-y-[calc(50%+0.5px)]' />
                      <div className='@4xl:grid-cols-3 grid *:p-8'>
                        <div className='@max-4xl:p-9 row-span-4 grid grid-rows-subgrid gap-8'>
                          <div className='self-end'>
                            <CardTitle className='text-lg font-medium'>Free</CardTitle>
                            <div className='text-muted-foreground mt-1 text-balance text-sm'>
                              Basic features for individuals and small teams
                            </div>
                          </div>

                          <div>
                            <NumberFlow value={0} prefix='$' className='text-3xl font-semibold' />
                            <div className='text-muted-foreground text-sm'>Per month</div>
                          </div>
                          <Button asChild variant='outline' className='w-full'>
                            <Link href={urls.signup}>Get Started</Link>
                          </Button>

                          <ul role='list' className='space-y-3 text-sm'>
                            {[
                              '1 team member',
                              '1 connected channel',
                              '50 AI completions/month',
                              '100 outbound emails/month',
                              '1 GB storage',
                              '5 saved views',
                              '3 workflows',
                              '100 workflow runs/month',
                            ].map((item, index) => (
                              <li key={index} className='flex items-center gap-2'>
                                <Check className='text-muted-foreground size-3' strokeWidth={3.5} />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className='rounded-(--radius) ring-foreground/10 bg-card @4xl:my-2 @max-4xl:mx-1 row-span-4 grid grid-rows-subgrid gap-8 border-transparent shadow shadow-xl ring-1 backdrop-blur'>
                          <div className='self-end'>
                            <CardTitle className='text-lg font-medium'>Starter</CardTitle>
                            <CardDescription className='text-muted-foreground mt-1 text-balance text-sm'>
                              Essential features for growing teams
                            </CardDescription>
                          </div>

                          <div>
                            <NumberFlow
                              value={prices.starter[billingPeriod]}
                              format={{
                                style: 'currency',
                                currency: 'USD',
                                maximumFractionDigits: 0,
                              }}
                              className='text-3xl font-semibold'
                            />
                            <div className='text-muted-foreground text-sm'>Per month</div>
                          </div>
                          <Button asChild className='w-full'>
                            <Link href={urls.signup}>Start Free Trial</Link>
                          </Button>

                          <div>
                            <div className='text-muted-foreground mb-3 text-xs'>
                              14-day free trial
                            </div>
                            <ul role='list' className='space-y-3 text-sm'>
                              {[
                                'Everything in Free, plus:',
                                'Unlimited team members',
                                '3 connected channels',
                                '500 AI completions/month',
                                '1,000 outbound emails/month',
                                '10 GB storage',
                                '20 saved views',
                                '1 knowledge base (50 articles)',
                                '5 datasets',
                                '15 workflows',
                                '5,000 workflow runs/month',
                              ].map((item, index) => (
                                <li
                                  key={index}
                                  className='group flex items-center gap-2 first:font-medium'>
                                  <Check
                                    className='text-muted-foreground size-3 group-first:hidden'
                                    strokeWidth={3.5}
                                  />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        <div className='@max-4xl:p-9 row-span-4 grid grid-rows-subgrid gap-8'>
                          <div className='self-end'>
                            <CardTitle className='text-lg font-medium'>Growth</CardTitle>
                            <CardDescription className='text-muted-foreground mt-1 text-balance text-sm'>
                              Advanced features for scaling businesses
                            </CardDescription>
                          </div>

                          <div>
                            <NumberFlow
                              value={prices.growth[billingPeriod]}
                              format={{
                                style: 'currency',
                                currency: 'USD',
                                maximumFractionDigits: 0,
                              }}
                              className='text-3xl font-semibold'
                            />
                            <div className='text-muted-foreground text-sm'>Per month</div>
                          </div>
                          <Button asChild variant='outline' className='w-full'>
                            <Link href={urls.signup}>Start Free Trial</Link>
                          </Button>

                          <div>
                            <div className='text-muted-foreground mb-3 text-xs'>
                              14-day free trial
                            </div>
                            <ul role='list' className='space-y-3 text-sm'>
                              {[
                                'Everything in Starter, plus:',
                                'Unlimited channels',
                                '5,000 AI completions/month',
                                '10,000 outbound emails/month',
                                '50 GB storage',
                                'Unlimited saved views',
                                'Unlimited knowledge bases',
                                'Unlimited datasets',
                                '15,000 workflow runs/month',
                                'API access (10,000 calls/month)',
                                'Webhooks',
                              ].map((item, index) => (
                                <li
                                  key={index}
                                  className='group flex items-center gap-2 first:font-medium'>
                                  <Check
                                    className='text-muted-foreground size-3 group-first:hidden'
                                    strokeWidth={3.5}
                                  />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className='relative mt-6'>
                      <PlusDecorator className='right-0 -translate-y-[calc(50%-0.5px)] translate-x-[calc(50%+0.5px)]' />

                      <div className='@4xl:grid-cols-3 @max-4xl:divide-y @4xl:divide-x grid border-t *:p-8'>
                        <div className='space-y-6'>
                          <div className='self-end'>
                            <CardTitle className='text-lg font-medium'>Enterprise</CardTitle>
                            <div className='text-muted-foreground mt-1 text-balance text-sm'>
                              Custom solutions for large organizations with dedicated support and
                              SLA guarantees.
                            </div>
                          </div>
                          <Button asChild variant='outline' className='@max-4xl:w-full'>
                            <Link href={`mailto:${emails.sales}`}>Contact Sales</Link>
                          </Button>
                        </div>
                        <div className='col-span-2'>
                          <ul
                            role='list'
                            className='@4xl:grid-cols-2 grid gap-x-14 gap-y-3 text-sm'>
                            {[
                              'Everything in Growth',
                              'AI Agent',
                              'SSO',
                              'Unlimited API calls',
                              'Unlimited storage',
                              'Custom integrations',
                              'Dedicated support',
                              'SLA guarantee',
                            ].map((item, index) => (
                              <li key={index} className='flex items-center gap-2'>
                                <Check className='text-muted-foreground size-3' strokeWidth={3.5} />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

// PlusDecorator renders a small plus symbol accent used by the layout.
const PlusDecorator = ({ className }: { className?: string }) => (
  <div
    aria-hidden
    className={cn(
      'mask-radial-from-15% before:bg-foreground/25 after:bg-foreground/25 absolute size-3 before:absolute before:inset-0 before:m-auto before:h-px after:absolute after:inset-0 after:m-auto after:w-px',
      className
    )}
  />
)
