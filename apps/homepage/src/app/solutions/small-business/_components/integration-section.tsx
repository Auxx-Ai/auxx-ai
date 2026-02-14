// apps/homepage/src/app/solutions/small-business/_components/integration-section.tsx
'use client'
import {
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle,
  Clock,
  FileText,
  MessageSquare,
  Users,
} from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

const { urls } = config

const integrationFeatures = [
  {
    icon: MessageSquare,
    title: 'Live Chat Support',
    description: 'Instant responses to customer inquiries with intelligent routing and escalation',
    metrics: '99.9% uptime',
    fillColor: 'fill-blue-100',
  },
  {
    icon: Calendar,
    title: 'Appointment Booking',
    description: 'Automated scheduling, confirmations, and calendar management for your business',
    metrics: '500+ bookings',
    fillColor: 'fill-green-100',
  },
  {
    icon: Users,
    title: 'Customer Management',
    description: 'Complete client profiles, interaction history, and personalized service tracking',
    metrics: '360° view',
    fillColor: 'fill-purple-100',
  },
  {
    icon: FileText,
    title: 'Document Handling',
    description: 'Automated processing of forms, quotes, invoices, and service agreements',
    metrics: 'Fully automated',
    fillColor: 'fill-yellow-100',
  },
  {
    icon: Clock,
    title: '24/7 Availability',
    description: 'Round-the-clock customer service without additional staffing costs',
    metrics: 'Always on',
    fillColor: 'fill-orange-100',
  },
  {
    icon: BarChart3,
    title: 'Business Analytics',
    description: 'Customer satisfaction metrics, response times, and business insights',
    metrics: 'Real-time',
    fillColor: 'fill-pink-100',
  },
]

const benefits = [
  'Quick 5-minute setup process',
  'Zero technical knowledge required',
  'Automatic system integration',
  'Enterprise-grade security',
  'Multi-location support',
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
                Business Integration
              </Badge>
              <h2 className='text-4xl font-semibold mb-6 text-foreground'>
                Seamless Business Integration
              </h2>
              <p className='text-lg text-muted-foreground max-w-3xl mx-auto'>
                Connect directly to your business systems and workflows. Access all your customer
                data instantly without complex setups or technical knowledge required.
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
                        Our business solution automatically configures all integrations and begins
                        handling customer inquiries immediately.
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
                        <h3 className='text-balance font-semibold text-xl'>Business Data</h3>
                        <Badge variant='secondary' className='text-xs'>
                          Live Sync
                        </Badge>
                      </div>
                      <p className='text-muted-foreground'>
                        Real-time synchronization with your business data for instant customer
                        service and support.
                      </p>
                    </div>
                    <div className='self-end px-8 pb-8'>
                      <div aria-hidden className='relative'>
                        <div className='mask-b-from-65% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border'>
                          <div className='bg-card ring-border/20 relative z-10 overflow-hidden rounded-2xl border border-transparent p-6 text-sm shadow-xl shadow-black/10 ring-1'>
                            <div className='space-y-1'>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>
                                  Inquiries handled
                                </span>
                                <span className='text-sm font-semibold text-foreground'>
                                  25,847
                                </span>
                              </div>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>
                                  Services managed
                                </span>
                                <span className='text-sm font-semibold text-foreground'>150+</span>
                              </div>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>Clients</span>
                                <span className='text-sm font-semibold text-foreground'>2,432</span>
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
                  Start Free Trial
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
