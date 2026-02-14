// apps/web/src/app/(website)/_components/sections/problem-solution-section.tsx

import { BarChart3, Clock, DollarSign, Mail, MessageSquare, Users, UserX, Zap } from 'lucide-react'

/**
 * Problem/Solution section highlighting pain points and solutions
 */
export default function ProblemSolutionSection() {
  const problems = [
    {
      icon: <Mail className='h-5 w-5' />,
      stat: '67%',
      title: 'of emails are repetitive',
      description: '"Where\'s my order?" takes up most of your time',
      color: 'text-red-500',
    },
    {
      icon: <Clock className='h-5 w-5' />,
      stat: '18-hour',
      title: 'average response time',
      description: 'Customers expect instant answers, not next-day replies',
      color: 'text-orange-500',
    },
    {
      icon: <DollarSign className='h-5 w-5' />,
      stat: '$75',
      title: 'cost per ticket',
      description: 'Human agents are expensive for simple questions',
      color: 'text-yellow-500',
    },
    {
      icon: <UserX className='h-5 w-5' />,
      stat: '43%',
      title: 'support team burnout',
      description: "Repetitive tasks drain your team's energy",
      color: 'text-red-600',
    },
  ]

  const solutions = [
    {
      icon: <Zap className='h-5 w-5' />,
      stat: '< 30 sec',
      title: 'AI responds instantly',
      description: 'Accurate answers to common questions 24/7',
      color: 'text-green-500',
    },
    {
      icon: <BarChart3 className='h-5 w-5' />,
      stat: 'Direct',
      title: 'Shopify integration',
      description: 'Real-time access to orders, inventory, and customer data',
      color: 'text-blue-500',
    },
    {
      icon: <MessageSquare className='h-5 w-5' />,
      stat: 'Human-like',
      title: 'responses in your voice',
      description: 'Maintains your brand tone and personality',
      color: 'text-purple-500',
    },
    {
      icon: <Users className='h-5 w-5' />,
      stat: 'Focus on',
      title: 'complex issues',
      description: 'Your team handles what really matters',
      color: 'text-indigo-500',
    },
  ]

  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='py-16 md:py-24 px-6'>
            <div className='text-center mb-12 md:mb-16'>
              <h2 className='text-3xl md:text-4xl font-bold text-foreground mb-4'>
                Your Support Team is Overwhelmed.
                <br />
                Your Customers are Waiting.
              </h2>
              <p className='text-lg text-muted-foreground max-w-2xl mx-auto'>
                Transform your customer support from a cost center into a competitive advantage
              </p>
            </div>

            <div className='grid lg:grid-cols-2 gap-8 lg:gap-12'>
              {/* Problems Column */}
              <div className='space-y-6'>
                <div className='flex items-center gap-2 mb-6'>
                  <div className='w-8 h-1 bg-red-500 rounded' />
                  <h3 className='text-xl font-semibold text-foreground'>The Problems</h3>
                </div>

                {problems.map((problem, index) => (
                  <div
                    key={index}
                    className='group relative p-6 rounded-xl bg-card border border-destructive/20 hover:border-destructive/40 transition-all duration-300'>
                    <div className='flex items-start gap-4'>
                      <div className={`p-2 rounded-lg bg-destructive/10 ${problem.color}`}>
                        {problem.icon}
                      </div>
                      <div className='flex-1'>
                        <div className='flex items-baseline gap-2 mb-1'>
                          <span className='text-2xl font-bold text-foreground'>{problem.stat}</span>
                          <span className='text-base font-medium text-foreground'>
                            {problem.title}
                          </span>
                        </div>
                        <p className='text-sm text-muted-foreground'>{problem.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Solutions Column */}
              <div className='space-y-6'>
                <div className='flex items-center gap-2 mb-6'>
                  <div className='w-8 h-1 bg-green-500 rounded' />
                  <h3 className='text-xl font-semibold text-foreground'>The Solution</h3>
                </div>

                {solutions.map((solution, index) => (
                  <div
                    key={index}
                    className='group relative p-6 rounded-xl bg-card border border-primary/20 hover:border-primary/40 transition-all duration-300'>
                    <div className='flex items-start gap-4'>
                      <div className={`p-2 rounded-lg bg-primary/10 ${solution.color}`}>
                        {solution.icon}
                      </div>
                      <div className='flex-1'>
                        <div className='flex items-baseline gap-2 mb-1'>
                          <span className='text-2xl font-bold text-foreground'>
                            {solution.stat}
                          </span>
                          <span className='text-base font-medium text-foreground'>
                            {solution.title}
                          </span>
                        </div>
                        <p className='text-sm text-muted-foreground'>{solution.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom CTA */}
            <div className='mt-12 md:mt-16 text-center'>
              <div className='inline-flex items-center gap-4 p-4 rounded-xl bg-primary/5 border border-primary/20'>
                <div className='text-left'>
                  <p className='text-sm font-medium text-foreground'>
                    Ready to transform your support?
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    Join 500+ stores saving 20+ hours weekly
                  </p>
                </div>
                <div className='h-10 w-px bg-border' />
                <div className='flex items-center gap-2 text-primary font-medium'>
                  <span>See ROI Calculator</span>
                  <span>→</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
