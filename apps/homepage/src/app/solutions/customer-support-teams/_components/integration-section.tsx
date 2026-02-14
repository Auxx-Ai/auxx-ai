// apps/homepage/src/app/solutions/customer-support-teams/_components/integration-section.tsx
'use client'
import { ArrowRight, BarChart3, Bot, Brain, CheckCircle, Clock, Users, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

const { urls } = config

const integrationFeatures = [
  {
    icon: Bot,
    title: 'AI Co-Pilot',
    description:
      'AI assistant that works alongside agents, suggesting responses and handling routine tasks',
    metrics: '75% efficiency boost',
    fillColor: 'fill-blue-100',
  },
  {
    icon: Zap,
    title: 'Smart Automation',
    description:
      'Automatically categorize, prioritize, and route tickets to the right team members',
    metrics: '5x faster routing',
    fillColor: 'fill-green-100',
  },
  {
    icon: Users,
    title: 'Team Collaboration',
    description: 'Seamless handoffs between AI and human agents with full context preservation',
    metrics: 'Zero context loss',
    fillColor: 'fill-purple-100',
  },
  {
    icon: Brain,
    title: 'Knowledge Base',
    description: 'AI-powered knowledge management that learns from every interaction',
    metrics: 'Self-improving',
    fillColor: 'fill-yellow-100',
  },
  {
    icon: Clock,
    title: 'Real-Time Insights',
    description: 'Live monitoring of agent performance, customer satisfaction, and queue status',
    metrics: 'Instant visibility',
    fillColor: 'fill-orange-100',
  },
  {
    icon: BarChart3,
    title: 'Performance Analytics',
    description: 'Detailed metrics on response times, resolution rates, and team productivity',
    metrics: 'Actionable insights',
    fillColor: 'fill-pink-100',
  },
]

const benefits = [
  'Seamless CRM integration',
  'Works with existing helpdesk',
  'No training required for agents',
  'Enterprise-grade security',
  'Multi-language support',
]

export default function IntegrationSection() {
  return (
    <section className='relative border-foreground/10 border-b '>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-muted/30' />

          <div className='relative z-10 mx-auto max-w-6xl px-6 py-24'>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              viewport={{ once: true }}
              className='text-center mb-16'>
              <Badge variant='outline' className='mb-4 px-3 py-1 text-xs uppercase tracking-wide'>
                Team Enhancement
              </Badge>
              <h2 className='text-4xl font-semibold mb-6 text-foreground'>
                AI-Powered Support Team Tools
              </h2>
              <p className='text-lg text-muted-foreground max-w-3xl mx-auto'>
                Integrate seamlessly with your existing support tools and CRM systems. Empower your
                team with AI assistance without disrupting current workflows.
              </p>
            </motion.div>

            <div className='bg-muted @container py-12 rounded-2xl mb-16'>
              <div className='mx-auto max-w-5xl px-6'>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  viewport={{ once: true }}
                  className='ring-foreground/10 @4xl:grid-cols-2 @max-4xl:divide-y @4xl:divide-x relative grid overflow-hidden rounded-2xl border border-transparent bg-background shadow-md shadow-black/5 ring-1'>
                  <div className='row-span-2 grid grid-rows-subgrid gap-8'>
                    <div className='px-8 pt-8'>
                      <div className='flex items-center gap-3 mb-4'>
                        <div className='w-8 h-8 rounded-full bg-green-100 flex items-center justify-center'>
                          <CheckCircle className='w-4 h-4 text-green-600' />
                        </div>
                        <span className='text-sm font-medium text-green-700'>
                          Installation Complete
                        </span>
                      </div>
                      <h3 className='text-balance font-semibold text-xl mb-3'>
                        Setup in Under 2 Minutes
                      </h3>
                      <p className='text-muted-foreground'>
                        Our AI solution automatically integrates with your helpdesk and begins
                        assisting your support agents immediately.
                      </p>
                    </div>
                    <div className='self-end px-8 pb-8'>
                      <div className='space-y-2'>
                        {benefits.map((benefit, index) => (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, x: -10 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: index * 0.1 }}
                            viewport={{ once: true }}
                            className='flex items-center gap-2'>
                            <CheckCircle className='w-4 h-4 text-green-500' />
                            <span className='text-sm text-muted-foreground'>{benefit}</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className='row-span-2 grid grid-rows-subgrid gap-8'>
                    <div className='relative z-10 px-8 pt-8'>
                      <div className='flex items-center justify-between mb-4'>
                        <h3 className='text-balance font-semibold text-xl'>Support Metrics</h3>
                        <Badge variant='secondary' className='text-xs'>
                          Live Sync
                        </Badge>
                      </div>
                      <p className='text-muted-foreground'>
                        Real-time analytics and insights into your support team's performance and
                        customer satisfaction metrics.
                      </p>
                    </div>
                    <div className='self-end px-8 pb-8'>
                      <div aria-hidden className='relative'>
                        <div className='mask-b-from-65% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border'>
                          <div className='bg-card ring-border/20 relative z-10 overflow-hidden rounded-2xl border border-transparent p-6 text-sm shadow-xl shadow-black/10 ring-1'>
                            <div className='space-y-1'>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>
                                  Tickets resolved
                                </span>
                                <span className='text-sm font-semibold text-foreground'>
                                  150,293
                                </span>
                              </div>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>
                                  Agents assisted
                                </span>
                                <span className='text-sm font-semibold text-foreground'>247</span>
                              </div>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>Customers</span>
                                <span className='text-sm font-semibold text-foreground'>
                                  89,432
                                </span>
                              </div>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-primary/10'>
                                <span className='text-sm text-muted-foreground'>
                                  Support tickets auto-resolved
                                </span>
                                <span className='text-sm font-semibold text-primary'>73%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              viewport={{ once: true }}>
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto px-6'>
                {integrationFeatures.map((feature, index) => {
                  const Icon = feature.icon
                  return (
                    <motion.div
                      key={feature.title}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: index * 0.1 }}
                      viewport={{ once: true }}
                      className='bg-background/70 backdrop-blur-sm rounded-2xl shadow-black/10 p-6 shadow-md ring-1 ring-foreground/10 hover:shadow-lg transition-shadow'>
                      <Icon className={`w-8 h-8 ${feature.fillColor} mb-4`} />
                      <h3 className='text-lg font-semibold text-foreground mb-2'>
                        {feature.title}
                      </h3>
                      <p className='text-sm text-muted-foreground mb-4'>{feature.description}</p>
                      <Badge variant='secondary' className='text-xs'>
                        {feature.metrics}
                      </Badge>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.8 }}
              viewport={{ once: true }}
              className='text-center mt-16'>
              <Button asChild>
                <Link href={urls.signup}>
                  Empower Your Team
                  <ArrowRight />
                </Link>
              </Button>
              <p className='text-sm text-muted-foreground mt-3'>
                Free 14-day trial • No credit card required
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}
