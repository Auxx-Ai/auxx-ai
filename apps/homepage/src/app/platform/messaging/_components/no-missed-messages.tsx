import { Mail, User, Zap } from 'lucide-react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'

const { urls } = config

const features = [
  {
    title: 'Zero missed messages',
    description: 'Route queries to the right person or team so customers get answers fast.',
    icon: <Mail className='stroke-foreground fill-blue-500/15' />,
  },
  {
    title: 'Instant customer context',
    description: 'Get the customer details and conversation history you need, summarized by AI.',
    icon: <User className='stroke-foreground fill-indigo-500/15' />,
  },
  {
    title: 'Real-time AI resolutions',
    description:
      'Provide instant, accurate chat support with AI custom trained for your help content.',
    icon: <Zap className='stroke-foreground fill-emerald-500/15' />,
  },
]

export default function NoMissedMessages() {
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted py-24'>
            <div className='mx-auto max-w-5xl px-6'>
              <div className='mx-auto max-w-4xl text-center'>
                <span className='text-primary bg-primary/5 border-primary/10 rounded-full border px-2 py-1 text-sm font-medium'>
                  Messaging
                </span>
                <h1 className='mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl'>
                  All your channels. One powerful workspace.
                </h1>
                <p className='text-muted-foreground mb-6 mt-4 text-balance text-lg'>
                  Exceptional support, simplified. Streamline customer communications with
                  AI-powered tools that deliver instant, accurate responses.
                </p>

                <Button asChild>
                  <Link href={urls.signup}>Get Started</Link>
                </Button>
                <Button asChild variant='outline' className='ml-3'>
                  <Link href={urls.demo}>Try Demo</Link>
                </Button>

                <div className='border-border-illustration mt-20 grid gap-6 border-y py-6 text-left sm:grid-cols-2 md:grid-cols-3 lg:gap-12'>
                  {features.map((feature, index) => (
                    <div key={index} className='space-y-3'>
                      <div className='bg-card ring-border-illustration flex size-8 items-center justify-center rounded-md shadow ring-1 *:size-4'>
                        {feature.icon}
                      </div>
                      <h2 className='text-lg font-medium'>{feature.title}</h2>
                      <p className='text-muted-foreground text-sm'>{feature.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
