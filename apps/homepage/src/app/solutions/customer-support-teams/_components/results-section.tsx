// apps/web/src/app/(website)/solutions/customer-support-teams/_components/results-section.tsx
'use client'
import { Clock, DollarSign, Star, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import { Badge } from '~/components/ui/badge'

const metrics = [
  {
    icon: TrendingUp,
    value: '60%',
    label: 'Increase in agent productivity',
    description: 'AI assistance enables faster ticket resolution',
  },
  {
    icon: Clock,
    value: '40%',
    label: 'Faster response times',
    description: 'AI suggests responses and automates routine tasks',
  },
  {
    icon: DollarSign,
    value: '35%',
    label: 'Reduction in training costs',
    description: 'New agents get up to speed faster with AI guidance',
  },
  {
    icon: Star,
    value: '4.9/5',
    label: 'Agent satisfaction',
    description: 'Support teams love their AI co-pilot',
  },
]

// const caseStudyStats = [
//   { label: 'Before Auxx.ai', metric: 'Tickets per agent/day', value: '25', color: 'text-red-500' },
//   {
//     label: 'After Auxx.ai',
//     metric: 'Tickets per agent/day',
//     value: '40',
//     color: 'text-green-500',
//   },
//   {
//     label: 'Before Auxx.ai',
//     metric: 'First contact resolution',
//     value: '65%',
//     color: 'text-red-500',
//   },
//   {
//     label: 'After Auxx.ai',
//     metric: 'First contact resolution',
//     value: '85%',
//     color: 'text-green-500',
//   },
//   {
//     label: 'Before Auxx.ai',
//     metric: 'Agent onboarding time',
//     value: '6 weeks',
//     color: 'text-red-500',
//   },
//   {
//     label: 'After Auxx.ai',
//     metric: 'Agent onboarding time',
//     value: '2 weeks',
//     color: 'text-green-500',
//   },
// ]

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
                Real Impact for Support Teams
              </h2>
              <p className='text-lg text-muted-foreground max-w-3xl mx-auto'>
                Join support teams across industries who have amplified their effectiveness with
                AI-powered assistance. Here's what they're achieving.
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
