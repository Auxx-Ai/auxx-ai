// apps/homepage/src/app/_components/sections/plans-section.tsx
'use client'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { useMedia } from '~/hooks/use-media'
import { useConfig } from '~/lib/config-context'
import { cn } from '~/lib/utils'

const plans = ['free', 'starter', 'growth'] as const

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
  const config = useConfig()
  const [activePlan, setActivePlan] = useState<Plan>('starter')
  const isMedium = useMedia('(min-width: 768px)')

  const categories: Category[] = [
    {
      name: 'Channels & Messaging',
      description: 'Connect your support channels and manage customer communication',
      features: [
        {
          name: 'Connected channels',
          description: 'Number of email inboxes and messaging channels you can connect.',
          plans: {
            free: '1',
            starter: '3',
            growth: 'Unlimited',
          },
        },
        {
          name: 'Outbound emails/month',
          description: 'Maximum number of outbound emails you can send per month.',
          plans: {
            free: '100',
            starter: '1,000',
            growth: '10,000',
          },
        },
        {
          name: 'File attachments',
          description: 'Attach files to tickets and messages.',
          plans: {
            free: true,
            starter: true,
            growth: true,
          },
        },
      ],
    },
    {
      name: 'AI & Automation',
      description: 'Automate your support workflows with AI-powered tools',
      features: [
        {
          name: 'AI completions/month',
          description: 'AI-powered draft replies and analysis for your tickets.',
          plans: {
            free: '50',
            starter: '500',
            growth: '5,000',
          },
        },
        {
          name: 'Workflows',
          description: 'Automated workflows to route, tag, and respond to tickets.',
          plans: {
            free: '3',
            starter: '15',
            growth: 'Unlimited',
          },
        },
        {
          name: 'Workflow runs/month',
          description: 'Number of automated workflow executions per month.',
          plans: {
            free: '100',
            starter: '5,000',
            growth: '15,000',
          },
        },
        {
          name: 'AI Agent',
          description: 'Fully autonomous AI agent that handles tickets end-to-end.',
          plans: {
            free: false,
            starter: false,
            growth: false,
          },
        },
      ],
    },
    {
      name: 'Knowledge & Data',
      description: 'Build your knowledge base and manage customer data',
      features: [
        {
          name: 'Knowledge bases',
          description: 'Self-service help centers for your customers.',
          plans: {
            free: false,
            starter: '1',
            growth: 'Unlimited',
          },
        },
        {
          name: 'Published articles',
          description: 'Number of published help articles.',
          plans: {
            free: false,
            starter: '50',
            growth: 'Unlimited',
          },
        },
        {
          name: 'Datasets',
          description: 'Structured data collections for AI context and automation.',
          plans: {
            free: false,
            starter: '5',
            growth: 'Unlimited',
          },
        },
        {
          name: 'Custom entities',
          description: 'Define custom data types to model your business.',
          plans: {
            free: '3',
            starter: '10',
            growth: 'Unlimited',
          },
        },
        {
          name: 'Storage',
          description: 'File storage for attachments and uploads.',
          plans: {
            free: '1 GB',
            starter: '10 GB',
            growth: '50 GB',
          },
        },
      ],
    },
    {
      name: 'Team & Platform',
      description: 'Collaborate with your team and integrate with your stack',
      features: [
        {
          name: 'Team members',
          description: 'Number of team members who can access the platform.',
          plans: {
            free: '1',
            starter: 'Unlimited',
            growth: 'Unlimited',
          },
        },
        {
          name: 'Saved views',
          description: 'Custom filtered views of your ticket queue.',
          plans: {
            free: '10',
            starter: '20',
            growth: 'Unlimited',
          },
        },
        {
          name: 'API access',
          description: 'Programmatic access to your data via REST API.',
          plans: {
            free: false,
            starter: false,
            growth: true,
          },
        },
        {
          name: 'Webhooks',
          description: 'Real-time event notifications to external services.',
          plans: {
            free: false,
            starter: false,
            growth: true,
          },
        },
        {
          name: 'SSO',
          description: 'Single sign-on for enterprise identity providers.',
          plans: {
            free: false,
            starter: false,
            growth: false,
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
    starter: (
      <Button className='lg:w-full' size='sm' asChild>
        <Link href={config.urls.signup}>Start Free Trial</Link>
      </Button>
    ),
    growth: (
      <Button className='lg:w-full' size='sm' asChild>
        <Link href={config.urls.signup}>Start Free Trial</Link>
      </Button>
    ),
  }

  const prices: Record<Plan, string> = {
    free: '$0 / month',
    starter: '$20 / month',
    growth: '$50 / month',
  }

  const renderPlanColumn = (plan: Plan) => {
    const planNames: Record<Plan, string> = {
      free: 'Free',
      starter: 'Starter',
      growth: 'Growth',
    }

    const header =
      plan === 'starter' ? (
        <div className='bg-muted sticky top-0 flex h-36 flex-col justify-center rounded-t-xl border-b px-4 max-md:hidden lg:px-6'>
          <div className='text-lg font-medium'>Starter</div>
          <div className='text-muted-foreground mb-4 mt-0.5'>{prices[plan]}</div>
          {plansActions[plan]}
        </div>
      ) : (
        <div className='bg-background sticky top-0 flex h-36 flex-col justify-center border-b px-4 pt-2 max-md:hidden lg:px-8'>
          <div className='text-lg font-medium'>{planNames[plan]}</div>
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
          plan === 'starter' && 'z-1 md:bg-muted md:ring-muted relative md:rounded-xl md:ring-1'
        )}>
        {header}
        {categories.map((category, index) => (
          <div key={index}>
            <div aria-hidden className={cn('h-14 md:h-28')} />
            <div>
              {category.features.map((feature, index) => (
                <div
                  key={index}
                  className='lg:in-data-[plan=starter]:px-6 flex h-14 items-center border-t px-6 text-sm last:h-[calc(3.5rem+1px)] last:border-b max-md:justify-center max-md:border-l md:px-4 lg:px-8'>
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
                                  <span className='bg-foreground/10 text-foreground/75 m-auto flex size-4 items-center justify-center rounded-full text-sm'>
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
                    plans.map((plan) => (
                      <div key={plan} className='group'>
                        {renderPlanColumn(plan)}
                      </div>
                    ))
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
        'bg-foreground/[0.065] text-foreground/75 flex size-5 items-center justify-center rounded-full font-sans text-xs font-semibold',
        checked && 'bg-emerald-500/10 text-emerald-600'
      )}>
      {checked ? '✓' : '-'}
    </span>
  )
}
