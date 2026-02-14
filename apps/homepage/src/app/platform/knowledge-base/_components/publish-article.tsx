// apps/homepage/src/app/platform/knowledge-base/_components/publish-article.tsx

import { ChevronRight, Cpu, Lock, Sparkles, Zap } from 'lucide-react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { Button } from '~/components/ui/button'
import { DropdownArticle } from './dropdown-article'

const { urls } = config

export default function PublishArticle() {
  return (
    <section className='overflow-hidden'>
      <div className='bg-zinc-50 py-24'>
        <div className='mx-auto w-full max-w-5xl px-6'>
          <div className='grid items-center gap-12 pb-12 md:grid-cols-2'>
            <div>
              <div className='max-w-md'>
                <h2 className='text-foreground text-balance text-4xl font-semibold'>
                  Publish & Power Your AI Responses
                </h2>
                <p className='my-6 text-balance text-lg'>
                  Create knowledge base articles and publish them to power your AI-driven customer
                  support with accurate, up-to-date information.
                </p>
                <p className='text-muted-foreground'>
                  Your published articles become the foundation for intelligent responses.{' '}
                  <span className='text-title font-medium'>LLM uses your knowledge base</span> to
                  provide contextually accurate answers to customer messages.
                </p>
                <Button className='mt-8 pr-2' variant='outline' asChild>
                  <Link href={urls.signup}>
                    Get started
                    <ChevronRight className='opacity-50' />
                  </Link>
                </Button>
              </div>
            </div>
            <DropdownArticle />
          </div>

          <div className='relative grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-12 sm:gap-6 lg:grid-cols-4'>
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <Zap className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Instant Publishing</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Publish articles instantly to make them available for AI-powered customer responses.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Cpu className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Smart Integration</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Seamlessly integrate knowledge base content with LLM processing for intelligent
                responses.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Lock className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Version Control</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Track article versions and manage content updates with secure publishing controls.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Sparkles className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>AI-Enhanced Responses</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Enable AI to reference your knowledge base for contextually relevant customer
                support responses.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
