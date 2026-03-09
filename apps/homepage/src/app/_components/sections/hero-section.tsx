// apps/homepage/src/app/_components/sections/hero-section.tsx
'use client'

import { Check, Clock, Play, Zap } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import MessagingFeatures from '@/app/platform/messaging/_components/messaging-features'
import { Button } from '~/components/ui/button'
import { useConfig } from '~/lib/config-context'

export default function HeroSection() {
  const { urls } = useConfig()
  const [showVideo, setShowVideo] = React.useState(false)

  return (
    <>
      <main role='main' className='bg-muted/50'>
        <section id='home' className='relative mx-auto max-w-6xl px-6 pt-32 text-center pb-10'>
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-x-0 -bottom-16 mx-auto h-40 max-w-2xl rounded-t-full bg-gradient-to-b from-blue-500/10 via-purple-500/10 to-pink-500/10 blur-3xl'
          />
          <div className='relative mx-auto max-w-4xl text-center'>
            <h1 className='text-foreground text-balance text-4xl font-semibold sm:mt-12 sm:text-6xl lg:text-7xl'>
              AI That Answers Your Customer Emails in Seconds, Not Hours
            </h1>
            <p className='text-muted-foreground mb-8 mt-6 text-balance text-lg sm:text-xl max-w-3xl mx-auto'>
              Auxx.ai automatically responds to support tickets with accurate, personalized answers
              by understanding your store data, order history, and business policies. Cut response
              times by 90% while your team focuses on growth.
            </p>

            <div className='flex flex-col sm:flex-row gap-4 justify-center items-center'>
              <Button asChild size='lg' className='px-8 text-base'>
                <Link href={urls.signup}>Start 14-Day Free Trial</Link>
              </Button>
              <Button
                variant='outline'
                size='lg'
                className='px-8 text-base'
                onClick={() => setShowVideo(true)}>
                <Play />
                Watch 2-Min Demo
              </Button>
            </div>

            <div className='flex flex-col sm:flex-row gap-4 sm:gap-6 justify-center items-center mt-6 text-sm text-muted-foreground'>
              <span className='flex items-center gap-2'>
                <Check className='h-4 w-4 text-green-500' />
                No credit card required
              </span>
              <span className='flex items-center gap-2'>
                <Clock className='h-4 w-4 text-blue-500' />
                5-minute setup
              </span>
              <span className='flex items-center gap-2'>
                <Zap className='h-4 w-4 text-purple-500' />
                Works with Gmail & Outlook
              </span>
            </div>

            <p className='mt-4 text-xs text-muted-foreground'>
              By signing up, you agree to our{' '}
              <Link href='/terms-of-service' className='underline hover:text-foreground'>
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href='/privacy-policy' className='underline hover:text-foreground'>
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          {/* Social Proof Banner */}
          <div className='mt-16 flex flex-wrap justify-center items-center gap-8 text-sm font-medium'>
            <div className='flex flex-col items-center'>
              <span className='text-3xl font-bold text-foreground'>500+</span>
              <span className='text-muted-foreground'>Shopify stores</span>
            </div>
            <div className='w-px h-12 bg-border hidden sm:block' />
            <div className='flex flex-col items-center'>
              <span className='text-3xl font-bold text-foreground'>1M+</span>
              <span className='text-muted-foreground'>Tickets resolved</span>
            </div>
            <div className='w-px h-12 bg-border hidden sm:block' />
            <div className='flex flex-col items-center'>
              <span className='text-3xl font-bold text-foreground'>4.9/5</span>
              <span className='text-muted-foreground'>Customer satisfaction</span>
            </div>
          </div>
        </section>
        <hr />
        {/* <section className="border-foreground/10 relative mt-16 border-y">
          <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
            <div className="border-x">
              <div
                aria-hidden
                className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
              />
              <div className="relative bg-gradient-to-b from-background to-muted/30 p-8">
                <div className="aspect-[16/9] rounded-lg border bg-card shadow-2xl overflow-hidden">
                  <div className="p-4 border-b flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                      </div>
                      <span className="text-sm text-muted-foreground">Auxx.ai Dashboard</span>
                    </div>
                  </div>
                  <div className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Incoming Support Email</h3>
                        <div className="p-4 rounded-lg bg-muted/50 border space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/20" />
                            <div className="flex-1">
                              <div className="font-medium text-sm">Sarah Johnson</div>
                              <div className="text-xs text-muted-foreground">
                                customer@example.com
                              </div>
                            </div>
                          </div>
                          <div className="text-sm">
                            "Where is my order #1234? I ordered 5 days ago and haven't received
                            tracking info yet."
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                          AI-Generated Response
                          <span className="text-xs bg-green-500/20 text-green-600 px-2 py-1 rounded">
                            0.3s
                          </span>
                        </h3>
                        <div className="p-4 rounded-lg bg-primary/5 border-primary/20 border space-y-2">
                          <div className="text-sm">
                            Hi Sarah,
                            <br />
                            <br />
                            Thank you for reaching out! I've located your order #1234 placed on Jan
                            15th.
                            <br />
                            <br />
                            Good news - your order shipped yesterday via USPS. Your tracking number
                            is:
                            <span className="font-mono bg-muted px-2 py-1 rounded text-xs ml-2">
                              1Z999AA1234567890
                            </span>
                            <br />
                            <br />
                            You should receive it within 2-3 business days. I've also sent the
                            tracking details to your email.
                            <br />
                            <br />
                            Is there anything else I can help you with?
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 flex items-center justify-center gap-8">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium">95% Accuracy</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-medium">30 sec avg response</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-purple-500" />
                        <span className="text-sm font-medium">70% automation rate</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section> */}
        <MessagingFeatures />
      </main>

      {/* Video Modal */}
      {showVideo && (
        <div
          className='fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4'
          onClick={() => setShowVideo(false)}>
          <div
            className='bg-card rounded-lg shadow-xl max-w-4xl w-full aspect-video'
            onClick={(e) => e.stopPropagation()}>
            <div className='p-4 border-b flex items-center justify-between'>
              <span className='font-semibold'>Auxx.ai Demo</span>
              <Button variant='ghost' size='sm' onClick={() => setShowVideo(false)}>
                Close
              </Button>
            </div>
            <div className='aspect-video bg-muted flex items-center justify-center'>
              <span className='text-muted-foreground'>Video player would go here</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
