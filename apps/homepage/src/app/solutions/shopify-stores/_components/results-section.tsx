// apps/web/src/app/(website)/solutions/shopify-stores/_components/results-section.tsx
'use client'
import { Clock, DollarSign, Star, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import { Badge } from '~/components/ui/badge'

const metrics = [
  {
    icon: TrendingUp,
    value: '73%',
    label: 'Reduction in support tickets',
    description: 'Automated resolution of common inquiries',
  },
  {
    icon: Clock,
    value: '< 30s',
    label: 'Average response time',
    description: 'Instant AI-powered responses 24/7',
  },
  {
    icon: DollarSign,
    value: '70%',
    label: 'Lower support costs',
    description: 'Significant reduction in per-ticket expense',
  },
  {
    icon: Star,
    value: '4.8/5',
    label: 'Customer satisfaction',
    description: 'Higher CSAT scores across all channels',
  },
]

const caseStudyStats = [
  { label: 'Before Auxx.ai', metric: 'Response time', value: '4.2 hours', color: 'text-red-500' },
  {
    label: 'After Auxx.ai',
    metric: 'Response time',
    value: '< 30 seconds',
    color: 'text-green-500',
  },
  { label: 'Before Auxx.ai', metric: 'Resolution rate', value: '45%', color: 'text-red-500' },
  { label: 'After Auxx.ai', metric: 'Resolution rate', value: '73%', color: 'text-green-500' },
  { label: 'Before Auxx.ai', metric: 'Support cost', value: '$12.50', color: 'text-red-500' },
  { label: 'After Auxx.ai', metric: 'Support cost', value: '$3.75', color: 'text-green-500' },
]

const Stripes = () => (
  <div
    aria-hidden
    className='absolute -inset-x-10 opacity-25 -inset-y-10 bg-[repeating-linear-gradient(-45deg,black,black_1px,transparent_1px,transparent_6px)] mix-blend-overlay [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]'
  />
)

export default function ResultsSection() {
  return (
    <section className='relative border-foreground/10 border-b '>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-muted/20' />

          <div className='relative py-24 z-10 mx-auto max-w-5xl px-6'>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              viewport={{ once: true }}
              className='text-center mb-16'>
              <Badge variant='outline' className='mb-4 px-3 py-1 text-xs uppercase tracking-wide'>
                Proven Results
              </Badge>
              <h2 className='text-4xl font-semibold mb-6 text-foreground'>
                Real Impact for Shopify Stores
              </h2>
              <p className='text-lg text-muted-foreground max-w-3xl mx-auto'>
                Join hundreds of successful Shopify merchants who have transformed their customer
                support with AI automation. Here's what they're achieving.
              </p>
            </motion.div>
            <div className='relative py-8'>
              <Stripes />
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                viewport={{ once: true }}
                className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 '>
                {metrics.map((metric, index) => {
                  const Icon = metric.icon
                  return (
                    <motion.div
                      key={metric.label}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: index * 0.1 }}
                      viewport={{ once: true }}
                      className='bg-zinc-50 relative backdrop-blur-sm rounded-3xl ring-foreground/10 ring-1 shadow-black/5  p-6 shadow-md text-center'>
                      <Icon className='w-8 h-8 fill-indigo-200 mx-auto mb-4' />
                      <div className='text-3xl font-bold text-foreground mb-2'>{metric.value}</div>
                      <div className='text-sm font-semibold text-foreground mb-2'>
                        {metric.label}
                      </div>
                      <p className='text-xs text-muted-foreground'>{metric.description}</p>
                    </motion.div>
                  )
                })}
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
