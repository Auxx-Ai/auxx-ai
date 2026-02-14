// apps/homepage/src/app/platform/live-chat/_components/live-chat-feature.tsx

import { Bot, ChevronRight, Filter, MessageCircle, UserCircle } from 'lucide-react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { Button } from '~/components/ui/button'
import { DropdownLiveChat } from './dropdown-live-chat'

const { urls } = config

export default function LiveChatFeature() {
  return (
    <section className='overflow-hidden'>
      <div className='bg-zinc-50 py-24'>
        <div className='mx-auto w-full max-w-5xl px-6'>
          <div className='grid items-center gap-12 pb-12 md:grid-cols-2'>
            <div>
              <div className='max-w-md'>
                <h2 className='text-foreground text-balance text-4xl font-semibold'>
                  Always Available for Your Customers
                </h2>
                <p className='my-6 text-balance text-lg'>
                  Deploy a fully branded live chat widget on your website or app, ensuring seamless
                  customer support whenever they need assistance.
                </p>
                <p className='text-muted-foreground'>
                  Your customers get instant help with intelligent responses.{' '}
                  <span className='text-title font-medium'>AI-powered automation</span> handles
                  inquiries efficiently while maintaining a personal touch.
                </p>
                <Button className='mt-8 pr-2' variant='outline' asChild>
                  <Link href={urls.signup}>
                    Get started
                    <ChevronRight className='opacity-50' />
                  </Link>
                </Button>
              </div>
            </div>
            <DropdownLiveChat />
          </div>

          <div className='relative grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-12 sm:gap-6 lg:grid-cols-4'>
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <MessageCircle className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Be There for Your Customers</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Set up a branded live chat widget for your website or app for seamless support when
                customers need it.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Bot className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Handle the Volume with Ease</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Customizable bots automatically gather the context needed to fast-track routing and
                replies.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <UserCircle className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Tailor Chat for Every Visitor</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Personalize bots based on account, contact, web, or conversation data for a
                one-of-a-kind experience.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Filter className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Triage Conversations with Ease</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Set up automation to tag and route chats so your team can quickly handle new
                messages.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
