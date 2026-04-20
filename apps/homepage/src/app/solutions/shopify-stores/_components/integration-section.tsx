// apps/homepage/src/app/solutions/shopify-stores/_components/integration-section.tsx
'use client'
import { GRADIENT_PALETTES, RandomGradient } from '@auxx/ui/components/random-gradient'
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  CreditCard,
  Package,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useConfig } from '~/lib/config-context'

const integrationFeatures = [
  {
    icon: ShoppingCart,
    title: 'Orders & Returns',
    description: 'Instant access to order history, tracking, and automated return processing',
    metrics: '99.9% accuracy',
    // fillColor: 'fill-black/50',
  },
  {
    icon: Package,
    title: 'Product Catalog',
    description: 'Real-time inventory, specifications, and intelligent product recommendations',
    metrics: '2M+ products',
    // fillColor: 'fill-black/50',
  },
  {
    icon: Users,
    title: 'Customer Data',
    description: 'Complete customer profiles, purchase history, and personalized support',
    metrics: '360° view',
    // fillColor: 'fill-black/50',
  },
  {
    icon: CreditCard,
    title: 'Payment & Refunds',
    description: 'Secure payment processing, refund automation, and dispute management',
    metrics: 'PCI compliant',
    // fillColor: 'fill-black/50',
  },
  {
    icon: Truck,
    title: 'Fulfillment',
    description: 'Shipping updates, carrier integration, and delivery tracking',
    metrics: '50+ carriers',
    // fillColor: 'fill-black/50',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    description: 'Support metrics, customer satisfaction, and performance insights',
    metrics: 'Real-time',
    // fillColor: 'fill-pink-100',
  },
]

const benefits = [
  'One-click Shopify app installation',
  'Zero configuration required',
  'Automatic data synchronization',
  'Enterprise-grade security',
  'Multi-store support',
]

export default function IntegrationSection() {
  const { urls } = useConfig()

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
                Native Integration
              </Badge>
              <h2 className='text-4xl font-semibold mb-6 text-foreground'>
                Deep Shopify Integration
              </h2>
              <p className='text-lg text-muted-foreground max-w-3xl mx-auto'>
                Connect directly to your Shopify store with our native app. Access all your data
                instantly without complex API setups or data migrations.
              </p>
            </motion.div>

            <div className='@container py-12 rounded-2xl mb-16 relative overflow-hidden'>
              <RandomGradient colors={[...GRADIENT_PALETTES.aurora]} mode='mesh' animated />
              <div className='mx-auto max-w-5xl px-6 relative z-10'>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  viewport={{ once: true }}
                  className='ring-foreground/5 @4xl:grid-cols-2 @max-4xl:divide-y @4xl:divide-x relative grid overflow-hidden rounded-2xl border border-transparent bg-background/50 shadow-md shadow-black/5 ring-1'>
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
                        Our Shopify app automatically configures all integrations and begins
                        processing support requests immediately.
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
                        <h3 className='text-balance font-semibold text-xl'>Shopify Store Data</h3>
                        <Badge variant='secondary' className='text-xs'>
                          Live Sync
                        </Badge>
                      </div>
                      <p className='text-muted-foreground'>
                        Real-time synchronization with your Shopify store data for instant customer
                        support.
                      </p>
                    </div>
                    <div className='self-end px-8 pb-8'>
                      <div aria-hidden className='relative'>
                        <div className='mask-b-from-65% dark:mask-b-from-80% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border'>
                          <div className='bg-card ring-border/20 relative z-10 overflow-hidden rounded-2xl border border-transparent p-6 text-sm shadow-xl shadow-black/10 ring-1'>
                            <div className='space-y-1'>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>
                                  Orders processed
                                </span>
                                <span className='text-sm font-semibold text-foreground'>
                                  1,847,293
                                </span>
                              </div>
                              <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                                <span className='text-sm text-muted-foreground'>
                                  Products synced
                                </span>
                                <span className='text-sm font-semibold text-foreground'>
                                  24,581
                                </span>
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
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
                {integrationFeatures.map((feature, index) => {
                  const Icon = feature.icon
                  return (
                    <motion.div
                      key={feature.title}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: index * 0.1 }}
                      viewport={{ once: true }}
                      className='relative overflow-hidden rounded-2xl shadow-black/10 p-6 shadow-md ring-1 ring-foreground/10 hover:shadow-lg transition-shadow'>
                      <RandomGradient
                        colors={[...GRADIENT_PALETTES.aurora]}
                        mode='hero'
                        seed={index * 1000 + 1}
                        animated
                      />
                      <div className='relative z-10'>
                        <Icon className={`w-8 h-8 ${feature.fillColor} mb-4`} />
                        <h3 className='text-lg font-semibold text-foreground mb-2'>
                          {feature.title}
                        </h3>
                        <p className='text-sm text-muted-foreground mb-4'>{feature.description}</p>
                        <Badge variant='secondary' className='text-xs bg-illustration/50'>
                          {feature.metrics}
                        </Badge>
                      </div>
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
                  Install Shopify App
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
