'use client'
import { GRADIENT_PALETTES, RandomGradient } from '@auxx/ui/components/random-gradient'
import { ArrowRight, Bot, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'

const automationStats = [
  { label: 'Response time', value: '< 30 sec', improvement: '85% faster' },
  { label: 'Resolution rate', value: '73%', improvement: 'First contact' },
  { label: 'Cost per ticket', value: '$0.42', improvement: '70% reduction' },
  { label: 'Customer satisfaction', value: '4.8/5', improvement: '23% increase' },
]
export function AutomationImpact() {
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='mx-auto w-full max-w-5xl px-6 pb-24'>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              viewport={{ once: true }}>
              <div className='rounded-2xl relative overflow-hidden p-8 shadow-md shadow-black/10 ring-1 ring-border-illustration'>
                <RandomGradient colors={[...GRADIENT_PALETTES.dusk]} mode='mesh' animated />
                <div className='grid grid-cols-1 md:grid-cols-2 gap-8 items-center z-10 relative'>
                  <div>
                    <div className='flex flex-col gap-2 mb-4'>
                      <Bot className='w-6 h-6 fill-indigo-200 dark:fill-indigo-500/30' />
                      <h3 className='text-2xl font-semibold text-foreground'>Automation Impact</h3>
                    </div>
                    <p className='text-muted-foreground mb-6'>
                      See the measurable impact of AI automation on your support operations. These
                      metrics are averaged across all Shopify stores using our platform.
                    </p>
                  </div>

                  <div className='space-y-4 ml-20'>
                    {automationStats.map((stat, index) => (
                      <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, x: 20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: index * 0.1 }}
                        viewport={{ once: true }}
                        className={cn(
                          'bg-illustration/50 ring-border-illustration/50 relative -mx-5 flex rounded-xl p-2 text-xs shadow shadow-black/10 ring-1',
                          index % 2 && 'ml-2'
                        )}>
                        {/* <div className="absolute inset-y-0 left-0 w-px bg-[length:1px_4px] bg-repeat-y opacity-25 [background-image:linear-gradient(180deg,var(--color-foreground)_1px,transparent_1px)]"></div> */}

                        <div className='flex items-center justify-between flex-1'>
                          <div>
                            <p className='text-sm text-muted-foreground'>{stat.label}</p>
                            <p className='text-2xl font-bold text-foreground'>{stat.value}</p>
                          </div>
                          <div className='text-right'>
                            <Badge variant='secondary' className='text-xs mb-1 bg-illustration/50'>
                              {stat.improvement}
                            </Badge>
                            <div className='flex items-center gap-1'>
                              <TrendingUp className='w-3 h-3 text-green-500' />
                              <ArrowRight className='w-3 h-3 text-muted-foreground' />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}
