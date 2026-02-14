'use client'
import { Button } from '@auxx/ui/components/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { ArrowLeft, Hash, Key, Phone, Shield } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import SettingsPage from '~/components/global/settings-page'
import { useIntegration } from '~/hooks/use-integration'

type Props = {}

// Schema for OpenPhone integration
const openPhoneSchema = z.object({
  apiKey: z.string().min(10, { error: 'API key is required and should be at least 10 characters' }),
  phoneNumberId: z.string().min(5, { error: 'Phone number ID is required (e.g., pnv_...)' }),
  phoneNumber: z.string().min(10, { error: 'Phone number is required in E.164 format' }),
  webhookSigningSecret: z.string().min(16, { error: 'Webhook signing secret is required' }),
})

type OpenPhoneFormValues = z.infer<typeof openPhoneSchema>

function OpenPhoneIntegrationForm({}: Props) {
  const { addOpenPhoneIntegration } = useIntegration()
  const router = useRouter()

  const handleBack = () => {
    router.push('/app/settings/integrations/new')
  }

  // For OpenPhone connection form
  const openPhoneForm = useForm<OpenPhoneFormValues>({
    resolver: standardSchemaResolver(openPhoneSchema),
    defaultValues: { apiKey: '', phoneNumberId: '', phoneNumber: '', webhookSigningSecret: '' },
  })

  // Handle OpenPhone form submission
  const onOpenPhoneSubmit = (values: OpenPhoneFormValues) => {
    addOpenPhoneIntegration.mutate(values, {
      onSuccess: () => {
        router.push('/app/settings/integrations')
      },
    })
  }

  return (
    <SettingsPage
      title='OpenPhone Integration'
      description='Setup your OpenPhone integration'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Integrations', href: '/app/settings/integrations' },
        { title: 'Add New Integration', href: '/app/settings/integrations/new' },
        { title: 'OpenPhone' },
      ]}
      button={
        <Button variant='outline' size='sm' onClick={handleBack}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back
        </Button>
      }>
      <div className='p-6'>
        <Form {...openPhoneForm}>
          <form onSubmit={openPhoneForm.handleSubmit(onOpenPhoneSubmit)} className='space-y-6'>
            <div className='flex flex-col space-y-1.5'>
              <div className='flex flex-col space-y-1.5'>
                <div className='flex items-center space-x-2'>
                  <Phone className='h-6 w-6 text-green-500' />
                  <div className='font-semibold leading-none tracking-tight'>Connect OpenPhone</div>
                </div>
                <div className='text-sm text-muted-foreground'>
                  Enter your OpenPhone API credentials to connect your phone number
                </div>
              </div>
              <div className='space-y-4'>
                <FormField
                  control={openPhoneForm.control}
                  name='apiKey'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key</FormLabel>
                      <FormControl>
                        <div className='flex items-center space-x-2'>
                          <Key className='h-4 w-4 text-muted-foreground' />
                          <Input type='password' placeholder='OpenPhone API Key' {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Find your API key in the OpenPhone dashboard under Settings &gt; Developer
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={openPhoneForm.control}
                  name='phoneNumberId'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number ID</FormLabel>
                      <FormControl>
                        <div className='flex items-center space-x-2'>
                          <Hash className='h-4 w-4 text-muted-foreground' />
                          <Input placeholder='e.g., pnv_123456789' {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>
                        The unique ID of your phone number (starts with pnv_)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={openPhoneForm.control}
                  name='phoneNumber'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <div className='flex items-center space-x-2'>
                          <Phone className='h-4 w-4 text-muted-foreground' />
                          <Input placeholder='+1234567890' {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Your phone number in E.164 format (e.g., +1234567890)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={openPhoneForm.control}
                  name='webhookSigningSecret'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Webhook Signing Secret</FormLabel>
                      <FormControl>
                        <div className='flex items-center space-x-2'>
                          <Shield className='h-4 w-4 text-muted-foreground' />
                          <Input type='password' placeholder='Webhook signing secret' {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Used to verify webhook requests from OpenPhone
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className='flex justify-between'>
                <Button type='button' variant='ghost' onClick={handleBack}>
                  <ArrowLeft />
                  Back
                </Button>
                <Button
                  type='submit'
                  variant='outline'
                  disabled={addOpenPhoneIntegration.isPending}
                  loading={addOpenPhoneIntegration.isPending}
                  loadingText='Connecting...'>
                  Connect OpenPhone
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </div>
    </SettingsPage>
  )
}

export default OpenPhoneIntegrationForm
