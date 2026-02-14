// apps/web/src/app/(website)/solutions/shopify-stores/_components/integration-cards.tsx
'use client'
import { CheckCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { Badge } from '~/components/ui/badge'

const benefits = [
  'One-click Shopify app installation',
  'Zero configuration required',
  'Automatic data synchronization',
  'Enterprise-grade security',
  'Multi-store support',
]

export default function IntegrationCards() {
  return (
    <div className='bg-muted @container py-12 rounded-2xl mb-16'>
      <div className='mx-auto max-w-5xl px-6'>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          viewport={{ once: true }}
          className='ring-foreground/10 @4xl:grid-cols-2 @max-4xl:divide-y @4xl:divide-x relative grid overflow-hidden rounded-2xl  bg-background shadow-md shadow-black/10 ring-1'>
          <div className='row-span-2 grid grid-rows-subgrid gap-8'>
            <div className='px-8 pt-8'>
              <div className='flex items-center gap-3 mb-4'>
                <div className='w-8 h-8 rounded-full bg-green-100 flex items-center justify-center'>
                  <CheckCircle className='w-4 h-4 text-green-600' />
                </div>
                <span className='text-sm font-medium text-green-700'>Installation Complete</span>
              </div>
              <h3 className='text-balance font-semibold text-xl mb-3'>Setup in Under 2 Minutes</h3>
              <p className='text-muted-foreground'>
                Our Shopify app automatically configures all integrations and begins processing
                support requests immediately.
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
                Real-time synchronization with your Shopify store data for instant customer support.
              </p>
            </div>
            <div className='self-end px-8 pb-8'>
              <div aria-hidden className='relative'>
                <div className='mask-b-from-65% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border'>
                  <div className='bg-card ring-border/20 relative z-10 overflow-hidden rounded-2xl border border-transparent p-6 text-sm shadow-xl shadow-black/10 ring-1'>
                    <div className='space-y-1'>
                      <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                        <span className='text-sm text-muted-foreground'>Orders processed</span>
                        <span className='text-sm font-semibold text-foreground'>1,847,293</span>
                      </div>
                      <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                        <span className='text-sm text-muted-foreground'>Products synced</span>
                        <span className='text-sm font-semibold text-foreground'>24,581</span>
                      </div>
                      <div className='flex justify-between items-center px-3 py-1 rounded-lg bg-muted/50'>
                        <span className='text-sm text-muted-foreground'>Customers</span>
                        <span className='text-sm font-semibold text-foreground'>89,432</span>
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
  )
}
