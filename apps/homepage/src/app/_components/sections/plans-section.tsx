'use client'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { useMedia } from '~/hooks/use-media'
import { config } from '~/lib/config'
import { cn } from '~/lib/utils'

const plans = ['free', 'pro', 'team'] as const

type PlanAvailability = boolean | string

type Plan = (typeof plans)[number]

type Feature = {
  name: string
  description?: string
  plans: Record<Plan, PlanAvailability>
}

type Category = {
  name: string
  description?: string
  features: Feature[]
}

export default function PlansSection() {
  const [activePlan, setActivePlan] = useState<Plan>('pro')
  const isMedium = useMedia('(min-width: 768px)')

  const categories: Category[] = [
    {
      name: 'Platform',
      description: 'Core features that enable seamless operations of your SaaS',
      features: [
        {
          name: 'Daily Exercises',
          description: 'Engage users with daily interactive exercises.',
          plans: {
            free: true,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Unlimited Storage',
          description: 'Store unlimited data with no additional cost.',
          plans: {
            free: '2 GB',
            pro: '100 GB',
            team: 'Unlimited',
          },
        },
        {
          name: 'Custom Dashboards',
          description: 'Create personalized dashboards for data visualization.',
          plans: {
            free: true,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Self-paced Learning',
          description: 'Empower users to learn at their own pace.',
          plans: {
            free: true,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Ad-free Experience',
          description: 'Provide an uninterrupted, ad-free environment.',
          plans: {
            free: false,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Team Collaboration',
          description: 'Enhance productivity with team collaboration tools.',
          plans: {
            free: false,
            pro: false,
            team: true,
          },
        },
      ],
    },
    {
      name: 'Infrastructure',
      description: 'Robust infrastructure to support your SaaS needs',
      features: [
        {
          name: 'Global CDN',
          description: 'Deliver content rapidly across the globe.',
          plans: {
            free: true,
            pro: true,
            team: 'Unlimited',
          },
        },
        {
          name: 'Scalable Servers',
          description: 'Automatically scale resources as demand grows.',
          plans: {
            free: false,
            pro: true,
            team: 'Unlimited',
          },
        },
        {
          name: 'Data Backups',
          description: 'Ensure data safety with regular backups.',
          plans: {
            free: false,
            pro: '3 days',
            team: '1 month',
          },
        },
        {
          name: 'API Access',
          description: 'Integrate seamlessly with third-party services.',
          plans: {
            free: false,
            pro: true,
            team: true,
          },
        },
        {
          name: '24/7 Monitoring',
          description: 'Keep your platform running smoothly with constant monitoring.',
          plans: {
            free: false,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Load Balancing',
          description: 'Distribute traffic efficiently across servers.',
          plans: {
            free: false,
            pro: false,
            team: true,
          },
        },
      ],
    },
    {
      name: 'Support',
      description: 'Comprehensive support to assist your users',
      features: [
        {
          name: 'Priority Support',
          description: 'Get fast-track assistance for urgent issues.',
          plans: {
            free: false,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Live Chat',
          description: 'Provide real-time support via chat.',
          plans: {
            free: false,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Knowledge Base',
          description: 'Access a rich repository of self-help articles.',
          plans: {
            free: true,
            pro: false,
            team: true,
          },
        },
        {
          name: 'Onboarding Assistance',
          description: 'Ensure smooth onboarding with expert guidance.',
          plans: {
            free: false,
            pro: '1 hour',
            team: '12 hours',
          },
        },
        {
          name: 'Community Forums',
          description: 'Engage in community discussions and support.',
          plans: {
            free: true,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Dedicated Account Manager',
          description: 'Receive personalized service and support.',
          plans: {
            free: false,
            pro: false,
            team: true,
          },
        },
      ],
    },
    {
      name: 'Analytics',
      description: 'Advanced analytics to drive data-driven decisions',
      features: [
        {
          name: 'Real-time Reports',
          description: 'Generate instant reports to track performance.',
          plans: {
            free: false,
            pro: true,
            team: true,
          },
        },
        {
          name: 'User Insights',
          description: 'Analyze user behavior to improve engagement.',
          plans: {
            free: false,
            pro: true,
            team: true,
          },
        },
        {
          name: 'Custom Metrics',
          description: 'Define and track metrics that matter to you.',
          plans: {
            free: false,
            pro: '10',
            team: 'Unlimited',
          },
        },
        {
          name: 'A/B Testing',
          description: 'Optimize features through controlled experiments.',
          plans: {
            free: false,
            pro: false,
            team: true,
          },
        },
        {
          name: 'Predictive Analytics',
          description: 'Leverage AI to predict future trends.',
          plans: {
            free: false,
            pro: false,
            team: true,
          },
        },
      ],
    },
  ]

  const plansActions: Record<Plan, ReactNode> = {
    free: (
      <Button className='lg:w-full' size='sm' asChild>
        <Link href={config.urls.signup}>Get Started</Link>
      </Button>
    ),
    pro: (
      <Button className='lg:w-full' size='sm' asChild>
        <Link href={config.urls.signup}>Start a free trial</Link>
      </Button>
    ),
    team: (
      <Button className='lg:w-full' size='sm' asChild>
        <Link href={`mailto:${config.emails.sales}`}>Contact Us</Link>
      </Button>
    ),
  }

  const prices: Record<Plan, string> = {
    free: '0$ / month',
    pro: '15$ / month',
    team: 'Custom',
  }

  const renderPlanColumn = (plan: Plan) => {
    const header =
      plan === 'pro' ? (
        <div className='bg-muted sticky top-0 flex h-36 flex-col justify-center rounded-t-xl border-b px-4 max-md:hidden lg:px-6'>
          <div className='text-lg font-medium'>Pro</div>
          <div className='text-muted-foreground mb-4 mt-0.5'>15$ / month</div>
          {plansActions[plan]}
        </div>
      ) : (
        <div className='bg-background sticky top-0 flex h-36 flex-col justify-center border-b px-4 pt-2 max-md:hidden lg:px-8'>
          <div className='text-lg font-medium'>{plan === 'free' ? 'Free' : 'Business'}</div>
          <div className='text-muted-foreground mb-4 mt-0.5'>{prices[plan]}</div>
          <div className='[--color-primary-foreground:var(--color-background)] [--color-primary:var(--color-foreground)]'>
            {plansActions[plan]}
          </div>
        </div>
      )

    return (
      <div
        data-plan={plan}
        className={cn(
          plan === 'pro' && 'z-1 md:bg-muted md:ring-muted relative md:rounded-xl md:ring-1'
        )}>
        {header}
        {categories.map((category, index) => (
          <div key={index}>
            <div aria-hidden className={cn('h-14 md:h-28')} />
            <div>
              {category.features.map((feature, index) => (
                <div
                  key={index}
                  className='lg:in-data-[plan=pro]:px-6 flex h-14 items-center border-t px-6 text-sm last:h-[calc(3.5rem+1px)] last:border-b max-md:justify-center max-md:border-l md:px-4 lg:px-8'>
                  <div>
                    {feature.plans[plan] === true ? (
                      <Indicator checked />
                    ) : feature.plans[plan] === false ? (
                      <Indicator />
                    ) : (
                      feature.plans[plan]
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className='flex h-6 items-center justify-center px-4 text-sm max-md:hidden lg:px-6' />
      </div>
    )
  }

  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='pb-16 md:py-24'>
            <div className='mx-auto max-w-5xl md:px-6'>
              {!isMedium && (
                <div className='bg-muted sticky top-0 z-10 flex justify-between gap-4 border-b px-5 py-3'>
                  <div className='flex justify-center'>
                    {plans.map((plan, index) => (
                      <button
                        key={index}
                        onClick={() => setActivePlan(plan)}
                        className='text-muted-foreground group max-md:px-1 md:block md:py-1'>
                        <span
                          className={cn(
                            'flex w-fit items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors [&>svg]:size-4',
                            activePlan === plan
                              ? 'bg-card ring-foreground/5 text-primary font-medium shadow-sm ring-1'
                              : 'hover:text-foreground group-hover:bg-foreground/5'
                          )}>
                          <span className='capitalize'>{plan}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {plansActions[activePlan]}
                </div>
              )}

              <div className='grid grid-cols-3 md:grid-cols-4'>
                <div className='col-span-2 md:col-span-1'>
                  <div className='bg-background z-1 sticky top-0 flex h-36 items-end gap-1.5 border-b py-2 max-md:hidden'>
                    <div className='text-muted-foreground text-sm font-medium'>Features</div>
                  </div>

                  {categories.map((category, index) => (
                    <div key={index}>
                      <div className='relative flex h-14 flex-col justify-center max-md:px-6 md:h-28'>
                        <h3 className='text-lg font-medium'>{category.name}</h3>
                        <p className='text-muted-foreground mt-1 line-clamp-2 text-balance text-sm max-md:hidden md:-mr-24'>
                          {category.description}
                        </p>
                      </div>
                      {category.features.map((feature, index) => (
                        <div
                          key={index}
                          className='text-muted-foreground flex h-14 items-center border-t last:h-[calc(3.5rem+1px)] last:border-b max-md:px-6'>
                          <div className='text-sm'>{feature.name}</div>{' '}
                          {feature.description && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger className='flex size-7'>
                                  <span className='bg-foreground/10 text-foreground/65 m-auto flex size-4 items-center justify-center rounded-full text-sm'>
                                    ?
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className='max-w-56 text-sm'>
                                  {feature.description}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className='grid md:col-span-3 md:grid-cols-3'>
                  {isMedium ? (
                    <>
                      {plans.map((plan) => (
                        <div key={plan} className='group'>
                          {renderPlanColumn(plan)}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div>{renderPlanColumn(activePlan)}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const Indicator = ({ checked = false }: { checked?: boolean }) => {
  return (
    <span
      className={cn(
        'bg-foreground/[0.065] text-foreground/65 flex size-5 items-center justify-center rounded-full font-sans text-xs font-semibold',
        checked && 'bg-emerald-500/10 text-emerald-600'
      )}>
      {checked ? '✓' : '-'}
    </span>
  )
}
