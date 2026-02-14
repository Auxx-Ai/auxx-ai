// apps/homepage/src/app/platform/crm/_components/how-it-works-section.tsx

import { ArrowRight, Brain, CheckCircle, Link2, Zap } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { config } from '@/lib/config'
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
        'GDPR & SOC 2 compliant',
      ],
      visual: (
        <div className='relative'>
          <div className='absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 blur-3xl' />
          <div className='relative bg-card rounded-lg border p-6 space-y-4'>
            <div className='flex items-center gap-3'>
              <div className='w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center'>
                <svg className='w-6 h-6 text-blue-500' viewBox='0 0 24 24' fill='currentColor'>
                  <path d='M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' />
                </svg>
              </div>
              <div>
                <div className='font-medium'>Gmail Connected</div>
                <div className='text-xs text-muted-foreground'>support@yourstore.com</div>
              </div>
              <CheckCircle className='h-5 w-5 text-green-500 ml-auto' />
            </div>
            <div className='flex items-center gap-3'>
              <div className='w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center'>
                <svg className='w-6 h-6 text-green-500' viewBox='0 0 24 24' fill='currentColor'>
                  <path d='M7 4V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2h3a1 1 0 0 1 0 2h-1v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6H4a1 1 0 0 1 0-2h3zm2 0h6V3H9v1z' />
                </svg>
              </div>
              <div>
                <div className='font-medium'>Shopify Connected</div>
                <div className='text-xs text-muted-foreground'>yourstore.myshopify.com</div>
              </div>
              <CheckCircle className='h-5 w-5 text-green-500 ml-auto' />
            </div>
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
        'Brand voice training',
      ],
      visual: (
        <div className='relative'>
          <div className='absolute inset-0 bg-gradient-to-br from-purple-500/20 to-pink-500/20 blur-3xl' />
          <div className='relative bg-card rounded-lg border p-6'>
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Training Progress</span>
                <span className='text-xs text-muted-foreground'>2 min remaining</span>
              </div>
              <div className='space-y-2'>
                <div className='flex items-center gap-3'>
                  <div className='flex-1 bg-muted rounded-full h-2 overflow-hidden'>
                    <div className='bg-green-500 h-full w-full' />
                  </div>
                  <CheckCircle className='h-4 w-4 text-green-500' />
                  <span className='text-xs'>FAQs imported</span>
                </div>
                <div className='flex items-center gap-3'>
                  <div className='flex-1 bg-muted rounded-full h-2 overflow-hidden'>
                    <div className='bg-green-500 h-full w-full' />
                  </div>
                  <CheckCircle className='h-4 w-4 text-green-500' />
                  <span className='text-xs'>Policies learned</span>
                </div>
                <div className='flex items-center gap-3'>
                  <div className='flex-1 bg-muted rounded-full h-2 overflow-hidden'>
                    <div className='bg-blue-500 h-full w-[75%] animate-pulse' />
                  </div>
                  <div className='h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin' />
                  <span className='text-xs'>Analyzing tickets...</span>
                </div>
              </div>
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
        'Performance analytics',
      ],
      visual: (
        <div className='relative'>
          <div className='absolute inset-0 bg-gradient-to-br from-green-500/20 to-blue-500/20 blur-3xl' />
          <div className='relative bg-card rounded-lg border p-6 shadow'>
            <div className='space-y-4'>
              <div className='flex items-center justify-between mb-4'>
                <span className='text-sm font-medium'>Live Activity</span>
                <div className='flex items-center gap-2'>
                  <div className='w-2 h-2 bg-green-500 rounded-full animate-pulse' />
                  <span className='text-xs text-green-500'>Active</span>
                </div>
              </div>
              <div className='space-y-3'>
                <div className='flex items-center gap-3 text-sm'>
                  <div className='w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center'>
                    <span className='text-xs'>JD</span>
                  </div>
                  <div className='flex-1'>
                    <div className='font-medium'>New ticket from John Doe</div>
                    <div className='text-xs text-muted-foreground'>AI responding in 0.3s...</div>
                  </div>
                  <CheckCircle className='h-4 w-4 text-green-500' />
                </div>
                <div className='flex items-center gap-3 text-sm'>
                  <div className='w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center'>
                    <span className='text-xs'>SM</span>
                  </div>
                  <div className='flex-1'>
                    <div className='font-medium'>Reply sent to Sarah Miller</div>
                    <div className='text-xs text-muted-foreground'>Order status provided</div>
                  </div>
                  <CheckCircle className='h-4 w-4 text-green-500' />
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
                  {index < steps.length - 1 && (
                    <div className='hidden md:block absolute top-12 left-[calc(100%-2rem)] w-16 lg:w-24'>
                      <div className='h-px bg-gradient-to-r from-border to-transparent' />
                      <ArrowRight className='absolute right-0 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                    </div>
                  )}

                  <div className='space-y-6'>
                    {/* Step number and icon */}
                    <div className='flex items-center gap-4'>
                      <div className='relative'>
                        <div className='text-4xl font-bold text-muted-foreground/30'>
                          {step.number}
                        </div>
                      </div>
                      <div className='p-3 rounded-lg bg-primary/10 text-primary'>{step.icon}</div>
                    </div>

                    {/* Content */}
                    <div className='space-y-4'>
                      <div>
                        <h3 className='text-xl font-semibold text-foreground mb-1'>{step.title}</h3>
                        <p className='text-sm font-medium text-primary'>{step.subtitle}</p>
                      </div>
                      <p className='text-muted-foreground text-sm leading-relaxed'>
                        {step.description}
                      </p>

                      {/* Features list */}
                      <ul className='space-y-2'>
                        {step.features.map((feature, i) => (
                          <li key={i} className='flex items-center gap-2 text-sm'>
                            <CheckCircle className='h-4 w-4 text-green-500 shrink-0' />
                            <span className='text-muted-foreground'>{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Visual representation */}
                      <div className='mt-6'>{step.visual}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className='mt-16 text-center'>
              <div className='inline-flex flex-col sm:flex-row items-center gap-4'>
                <Button asChild size='lg'>
                  <Link href={urls.signup}>
                    Get started
                    <ArrowRight />
                  </Link>
                </Button>
                <span className='text-sm text-muted-foreground'>
                  or{' '}
                  <Link href={urls.demo} className='text-info hover:underline'>
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
