// apps/web/src/app/(website)/solutions/customer-support-teams/_components/automation-section.tsx
'use client'
import { Clock, MessageSquare, RefreshCw, Search, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import { Badge } from '~/components/ui/badge'

const automationWorkflows = [
  {
    icon: Search,
    title: 'Information Lookup',
    description: 'Customer asks about services or pricing',
    automation: 'AI fetches relevant information and provides instant answers',
    timesSaved: '3 mins',
    accuracy: '99.5%',
    steps: [
      'Parse customer inquiry',
      'Extract key details',
      'Query business database',
      'Format personalized response',
    ],
  },
  {
    icon: RefreshCw,
    title: 'Appointment Booking',
    description: 'Customer wants to schedule a service',
    automation: 'AI checks availability and books appointments automatically',
    timesSaved: '6 mins',
    accuracy: '98.1%',
    steps: [
      'Check service availability',
      'Confirm customer preferences',
      'Book appointment slot',
      'Send confirmation details',
    ],
  },
  {
    icon: MessageSquare,
    title: 'Service Questions',
    description: 'Customer needs service information',
    automation: 'AI provides detailed service info and recommendations',
    timesSaved: '4 mins',
    accuracy: '96.8%',
    steps: [
      'Identify service inquiry',
      'Fetch service details',
      'Generate tailored response',
      'Suggest additional services',
    ],
  },
]

export default function AutomationSection() {
  return (
    <section className='relative border-foreground/10'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='mx-auto w-full max-w-5xl px-6 pt-24 overflow-hidden'>
            <div className='absolute inset-0 bg-gradient-to-bl from-muted/30 via-transparent to-indigo/5' />
            <div className='relative z-10 mx-auto '>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                viewport={{ once: true }}
                className='text-center mb-16'>
                <Badge variant='outline' className='mb-4 px-3 py-1 text-xs uppercase tracking-wide'>
                  Intelligent Automation
                </Badge>
                <h2 className='text-4xl font-semibold mb-6 text-foreground'>
                  Automate Small Business Support
                </h2>
                <p className='text-lg text-muted-foreground max-w-3xl mx-auto'>
                  Our AI handles the most common customer inquiries automatically, from service
                  questions to appointment booking, freeing your team to focus on complex issues
                  that need personal attention.
                </p>
              </motion.div>

              <div className='grid grid-cols-1 lg:grid-cols-3 gap-8 mb-16'>
                {automationWorkflows.map((workflow, index) => {
                  const Icon = workflow.icon
                  return (
                    <motion.div
                      key={workflow.title}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, delay: index * 0.2 }}
                      viewport={{ once: true }}
                      className=' backdrop-blur-sm rounded-2xl ring-foreground/10 ring-1 p-6 shadow-md shadow-black/10'>
                      <div className='flex items-center gap-3 mb-6'>
                        <Icon className='size-6 fill-indigo-50' />
                        <h3 className='text-xl font-semibold text-foreground'>{workflow.title}</h3>
                      </div>

                      <div className='space-y-4'>
                        <div className='flex flex-row items-start gap-2'>
                          <StepNumber>1</StepNumber>
                          <div>
                            <p className='text-sm  font-bold text-primary-600 '>Customer inquiry</p>
                            <p className='text-sm text-foreground'>{workflow.description}</p>
                          </div>
                        </div>

                        <div className='space-y-2 pb-4'>
                          <div className='flex flex-row items-start gap-2'>
                            <StepNumber>2</StepNumber>
                            <div className='space-y-2'>
                              <p className='text-sm font-bold text-primary-600'>Automation steps</p>
                              {workflow.steps.map((step, stepIndex) => (
                                <div
                                  key={stepIndex}
                                  className='text-foreground before:border-muted-foreground before:bg-black/5 before:ring-black/5 relative mt-0.5 gap-2 text-sm font-medium before:absolute before:inset-y-0 before:-left-[22px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring'>
                                  <span className='text-xs text-muted-foreground'>{step}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className='relative'>
                          <div className='absolute inset-0 scale-100 opacity-100 blur-lg transition-all duration-300'>
                            <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-x-6 bottom-0 top-12 -translate-y-3 from-pink-400 to-purple-400'></div>
                          </div>
                          <div className='bg-zinc-50 ring-1 shadow-md shadow-black/10 ring-foreground/10  rounded-lg p-4 relative overflow-hidden'>
                            <p className='text-sm font-medium text-foreground mb-2'>
                              {workflow.automation}
                            </p>

                            {/* <CurrencyIllustration /> */}

                            <div className='flex items-center justify-between text-xs'>
                              <div className='flex items-center gap-2'>
                                <Clock className='w-3 h-3 text-foreground' />
                                <span className='text-foreground font-semibold'>
                                  {workflow.timesSaved} saved
                                </span>
                              </div>
                              <div className='flex items-center gap-2'>
                                <TrendingUp className='w-3 h-3 text-foreground' />
                                <span className='text-foreground font-semibold'>
                                  {workflow.accuracy} accuracy
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const StepNumber = ({ children }: { children: React.ReactNode }) => {
  return (
    <span className='bg-background shrink-0 ring-foreground/10 text-foreground relative flex size-6 items-center justify-center rounded-full border border-transparent font-mono text-xs font-medium shadow ring-1'>
      {children}
    </span>
  )
}
