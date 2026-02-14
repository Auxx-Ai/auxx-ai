'use client'

// src/app/(protected)/app/settings/chat/_components/widget-install-guide.tsx

import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { ArrowLeft, Check, ClipboardCopy, Code, Globe } from 'lucide-react'
import Link from 'next/link'
import React, { useState } from 'react'
import { api } from '~/trpc/react'

interface WidgetInstallGuideProps {
  widgetId: string
  widget: any
}

export function WidgetInstallGuide({ widgetId, widget }: WidgetInstallGuideProps) {
  const [copied, setCopied] = useState(false)

  // Get installation code
  const installCodeQuery = api.widget.getInstallationCode.useQuery({ widgetId })

  const installScript = installCodeQuery.data?.script || ''

  // Copy to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(installScript)
      setCopied(true)
      toastSuccess({ title: 'Copied to clipboard' })
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      toastError({ title: 'Failed to copy script to clipboard' })
    }
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>Install Widget: {widget.name}</h1>

        <Button variant='outline' asChild>
          <Link href='/app/settings/chat'>
            <ArrowLeft className='mr-2 h-4 w-4' />
            Back to widgets
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Installation Guide</CardTitle>
          <CardDescription>
            Embed this widget on your website by adding the following script to your HTML
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue='script' className='w-full'>
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='script'>Installation Script</TabsTrigger>
              <TabsTrigger value='advanced'>Advanced Options</TabsTrigger>
            </TabsList>
            <TabsContent value='script' className='mt-4 space-y-4'>
              <div className='space-y-2'>
                <p className='text-sm text-muted-foreground'>
                  Add this script right before the closing <code>{'</body>'}</code> tag of every
                  page where you want the widget to appear:
                </p>

                <div className='relative'>
                  <pre className='overflow-x-auto rounded-md bg-muted p-4'>
                    <code className='text-xs sm:text-sm'>{installScript}</code>
                  </pre>

                  <Button
                    size='sm'
                    variant='ghost'
                    className='absolute right-2 top-2'
                    onClick={copyToClipboard}
                    disabled={installCodeQuery.isLoading}>
                    {copied ? <Check className=' text-green-500' /> : <ClipboardCopy />}
                  </Button>
                </div>
              </div>

              <div className='rounded-md bg-blue-50 p-4 dark:bg-blue-950'>
                <div className='flex'>
                  <div className='shrink-0'>
                    <Globe className='h-5 w-5 text-blue-500' />
                  </div>
                  <div className='ml-3'>
                    <h3 className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                      Allowed Domains
                    </h3>
                    <div className='mt-2 text-sm text-blue-700 dark:text-blue-400'>
                      <p>
                        {widget.allowedDomains && widget.allowedDomains.length > 0 ? (
                          <>
                            This widget is configured to work only on the following domains:
                            <ul className='mt-1 list-inside list-disc'>
                              {widget.allowedDomains.map((domain: string) => (
                                <li key={domain}>{domain}</li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          'This widget will work on any domain. You can restrict it to specific domains in the widget settings.'
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value='advanced' className='mt-4 space-y-4'>
              <div className='space-y-2'>
                <h3 className='text-lg font-medium'>JavaScript API</h3>
                <p className='text-sm text-muted-foreground'>
                  You can also control the widget programmatically after installation:
                </p>

                <div className='mt-4 space-y-4'>
                  <div>
                    <h4 className='text-sm font-medium'>Open the widget:</h4>
                    <pre className='mt-2 overflow-x-auto rounded-md bg-muted p-2'>
                      <code className='text-xs'>window.AuxxChat.open();</code>
                    </pre>
                  </div>

                  <div>
                    <h4 className='text-sm font-medium'>Close the widget:</h4>
                    <pre className='mt-2 overflow-x-auto rounded-md bg-muted p-2'>
                      <code className='text-xs'>window.AuxxChat.close();</code>
                    </pre>
                  </div>

                  <div>
                    <h4 className='text-sm font-medium'>Toggle the widget:</h4>
                    <pre className='mt-2 overflow-x-auto rounded-md bg-muted p-2'>
                      <code className='text-xs'>window.AuxxChat.toggle();</code>
                    </pre>
                  </div>

                  <div>
                    <h4 className='text-sm font-medium'>Set user information:</h4>
                    <pre className='mt-2 overflow-x-auto rounded-md bg-muted p-2'>
                      <code className='text-xs'>{`window.AuxxChat.setUserInfo({
  name: "John Doe",
  email: "john@example.com",
  // Any custom properties
  customerId: "123456"
});`}</code>
                    </pre>
                  </div>

                  <div>
                    <h4 className='text-sm font-medium'>Send a message programmatically:</h4>
                    <pre className='mt-2 overflow-x-auto rounded-md bg-muted p-2'>
                      <code className='text-xs'>{`window.AuxxChat.sendMessage("Hello, I have a question about my order #12345");`}</code>
                    </pre>
                  </div>
                </div>
              </div>

              <div className='rounded-md bg-amber-50 p-4 dark:bg-amber-950'>
                <div className='flex'>
                  <div className='shrink-0'>
                    <Code className='h-5 w-5 text-amber-500' />
                  </div>
                  <div className='ml-3'>
                    <h3 className='text-sm font-medium text-amber-800 dark:text-amber-300'>
                      Advanced Integration
                    </h3>
                    <div className='mt-2 text-sm text-amber-700 dark:text-amber-400'>
                      <p>
                        For more advanced integrations, including custom styling, event callbacks,
                        and integration with your user authentication system, please refer to our
                        developer documentation.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className='border-t pt-6'>
          <Button variant='outline' asChild className='mr-auto'>
            <Link href={`/app/settings/chat/${widgetId}`}>
              <ArrowLeft className='mr-2 h-4 w-4' />
              Back to Widget
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
