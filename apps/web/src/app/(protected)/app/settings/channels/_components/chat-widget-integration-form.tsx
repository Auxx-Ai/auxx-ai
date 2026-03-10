// ~/app/(protected)/app/settings/channels/_components/chat-widget-integration-form.tsx
'use client'
import { widgetSchema as chatWidgetInputSchema } from '@auxx/lib/widgets/types' // Use the schema from types
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  ArrowLeft,
  BrainCircuit,
  Globe,
  Loader2,
  MessageSquare,
  Palette,
  Settings,
} from 'lucide-react' // Icons
import { useRouter } from 'next/navigation'
import React from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'

// Define the form schema by combining Integration name and ChatWidget fields
const formSchema = z.object({
  name: z.string().min(1, 'Widget name is required'),
  // Include fields from chatWidgetInputSchema, making optional fields truly optional for creation form
  title: chatWidgetInputSchema.shape.title,
  subtitle: chatWidgetInputSchema.shape.subtitle.optional(),
  primaryColor: chatWidgetInputSchema.shape.primaryColor.optional().default('#4F46E5'),
  logoUrl: chatWidgetInputSchema.shape.logoUrl.optional(),
  position: chatWidgetInputSchema.shape.position.optional().default('BOTTOM_RIGHT'),
  welcomeMessage: chatWidgetInputSchema.shape.welcomeMessage.optional(),
  autoOpen: chatWidgetInputSchema.shape.autoOpen.optional().default(false),
  mobileFullScreen: chatWidgetInputSchema.shape.mobileFullScreen.optional().default(true),
  collectUserInfo: chatWidgetInputSchema.shape.collectUserInfo.optional().default(false),
  offlineMessage: chatWidgetInputSchema.shape.offlineMessage
    .optional()
    .default("We're currently offline..."),
  allowedDomains: chatWidgetInputSchema.shape.allowedDomains
    .optional()
    .default([])
    .transform((val) => val?.filter((d) => d.trim() !== '') ?? []), // Ensure empty strings are removed
  useAi: chatWidgetInputSchema.shape.useAi.optional().default(false),
  aiModel: chatWidgetInputSchema.shape.aiModel.optional(),
  aiInstructions: chatWidgetInputSchema.shape.aiInstructions.optional(),
  // Operating hours would be handled separately if needed
})

type ChatWidgetFormValues = z.infer<typeof formSchema>

export default function ChatWidgetIntegrationForm() {
  const router = useRouter()
  const addChatWidget = api.integration.addChatWidgetIntegration.useMutation()

  const handleBack = () => {
    router.push('/app/settings/channels/new')
  }

  const form = useForm<ChatWidgetFormValues>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      name: '',
      title: 'Chat Support',
      subtitle: '',
      primaryColor: '#4F46E5',
      logoUrl: '',
      position: 'BOTTOM_RIGHT',
      welcomeMessage: 'Welcome! How can we help you today?',
      autoOpen: false,
      mobileFullScreen: true,
      collectUserInfo: false,
      offlineMessage: "We're currently offline. Please leave a message...",
      allowedDomains: [],
      useAi: false,
      aiModel: '',
      aiInstructions: '',
    },
  })

  const onSubmit = (values: ChatWidgetFormValues) => {
    console.log('Submitting Chat Widget Form:', values)
    addChatWidget.mutate(values, {
      onSuccess: (data) => {
        toastSuccess({
          title: 'Chat Widget Created',
          description: `Integration "${values.name}" added successfully.`,
        })
        // Redirect to the new integration's settings page
        router.push(`/app/settings/channels/${data.integrationId}`)
      },
      onError: (error) => {
        toastError({ title: 'Failed to Create Widget', description: error.message })
        console.error('Error adding chat widget:', error)
      },
    })
  }

  // State for managing domain input
  const [currentDomain, setCurrentDomain] = React.useState('')

  const handleAddDomain = () => {
    const trimmedDomain = currentDomain.trim()
    if (trimmedDomain && !form.getValues('allowedDomains')?.includes(trimmedDomain)) {
      form.setValue('allowedDomains', [...(form.getValues('allowedDomains') ?? []), trimmedDomain])
      setCurrentDomain('') // Clear input
    }
  }

  const handleRemoveDomain = (domainToRemove: string) => {
    form.setValue(
      'allowedDomains',
      form.getValues('allowedDomains')?.filter((d) => d !== domainToRemove) ?? []
    )
  }

  return (
    <SettingsPage
      title={`Chat Integration`}
      description='Setup your new integration'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Channels', href: '/app/settings/channels' },
        { title: 'Add New Channel', href: '/app/settings/channels/new' },
        { title: 'Chat Integration' },
      ]}
      button={
        <Button variant='outline' size='sm' onClick={handleBack}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back
        </Button>
      }>
      <div className='p-6'>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
            <Card className='mx-auto max-w-4xl'>
              <CardHeader>
                <div className='flex items-center space-x-2'>
                  <MessageSquare className='h-6 w-6 text-indigo-500' />
                  <CardTitle>Create New Chat Widget</CardTitle>
                </div>
                <CardDescription>
                  Configure the details for your new website chat widget.
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-6'>
                {/* --- General --- */}
                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Widget Name (Internal)</FormLabel>
                      <FormControl>
                        <Input placeholder='e.g., Support Widget' {...field} />
                      </FormControl>
                      <FormDescription>
                        An internal name to identify this widget integration.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* --- Appearance --- */}
                <h3 className='mt-6 flex items-center gap-2 border-b pb-2 text-lg font-medium'>
                  <Palette size={20} /> Appearance
                </h3>
                <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='title'
                    render={({ field }) => (
                      <FormItem>
                        {' '}
                        <FormLabel>Widget Title</FormLabel>{' '}
                        <FormControl>
                          <Input placeholder='Chat Support' {...field} />
                        </FormControl>{' '}
                        <FormMessage />{' '}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='subtitle'
                    render={({ field }) => (
                      <FormItem>
                        {' '}
                        <FormLabel>Subtitle</FormLabel>{' '}
                        <FormControl>
                          <Input placeholder='Typically replies in minutes' {...field} />
                        </FormControl>{' '}
                        <FormMessage />{' '}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='primaryColor'
                    render={({ field }) => (
                      <FormItem>
                        {' '}
                        <FormLabel>Primary Color</FormLabel>{' '}
                        <FormControl>
                          <Input type='color' {...field} />
                        </FormControl>
                        <FormDescription>
                          Main color for the widget header and button.
                        </FormDescription>{' '}
                        <FormMessage />{' '}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='logoUrl'
                    render={({ field }) => (
                      <FormItem>
                        {' '}
                        <FormLabel>Logo URL (Optional)</FormLabel>{' '}
                        <FormControl>
                          <Input
                            type='url'
                            placeholder='https://yourdomain.com/logo.png'
                            {...field}
                          />
                        </FormControl>{' '}
                        <FormMessage />{' '}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='position'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position on Page</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder='Select position' />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value='BOTTOM_RIGHT'>Bottom Right</SelectItem>
                            <SelectItem value='BOTTOM_LEFT'>Bottom Left</SelectItem>
                            <SelectItem value='TOP_RIGHT'>Top Right</SelectItem>
                            <SelectItem value='TOP_LEFT'>Top Left</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {/* --- Behavior --- */}
                <h3 className='mt-6 flex items-center gap-2 border-b pb-2 text-lg font-medium'>
                  <Settings size={20} /> Behavior
                </h3>
                <FormField
                  control={form.control}
                  name='welcomeMessage'
                  render={({ field }) => (
                    <FormItem>
                      {' '}
                      <FormLabel>Welcome Message</FormLabel>{' '}
                      <FormControl>
                        <Textarea placeholder='Welcome! How can we help?' {...field} />
                      </FormControl>{' '}
                      <FormDescription>
                        Sent automatically when a visitor starts a chat.
                      </FormDescription>
                      <FormMessage />{' '}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='offlineMessage'
                  render={({ field }) => (
                    <FormItem>
                      {' '}
                      <FormLabel>Offline Message</FormLabel>{' '}
                      <FormControl>
                        <Textarea placeholder="We're offline..." {...field} />
                      </FormControl>
                      <FormDescription>
                        Shown when chat is initiated outside operating hours (if configured).
                      </FormDescription>{' '}
                      <FormMessage />{' '}
                    </FormItem>
                  )}
                />
                <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='autoOpen'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                        <div className='space-y-0.5'>
                          <FormLabel>Auto Open Chat</FormLabel>
                          <FormDescription>
                            Automatically open the chat window for visitors.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='mobileFullScreen'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                        <div className='space-y-0.5'>
                          <FormLabel>Mobile Full Screen</FormLabel>
                          <FormDescription>Use full screen mode on mobile devices.</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='collectUserInfo'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                        <div className='space-y-0.5'>
                          <FormLabel>Collect User Info</FormLabel>
                          <FormDescription>
                            Ask for name/email before starting chat.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                {/* --- Domain Allowlist --- */}
                <h3 className='mt-6 flex items-center gap-2 border-b pb-2 text-lg font-medium'>
                  <Globe size={20} /> Allowed Domains
                </h3>
                <FormDescription>
                  Restrict the widget to specific website domains (e.g., yourdomain.com). Leave
                  empty to allow on any domain.
                </FormDescription>
                <div className='mt-2 flex items-center space-x-2'>
                  <Input
                    placeholder='example.com'
                    value={currentDomain}
                    onChange={(e) => setCurrentDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddDomain()
                      }
                    }}
                  />
                  <Button type='button' variant='outline' onClick={handleAddDomain}>
                    Add
                  </Button>
                </div>
                <div className='mt-2 space-y-1'>
                  {form.watch('allowedDomains')?.map((domain) => (
                    <div
                      key={domain}
                      className='flex items-center justify-between rounded bg-muted p-1 text-sm'>
                      <span>{domain}</span>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => handleRemoveDomain(domain)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
                <FormField
                  control={form.control}
                  name='allowedDomains'
                  render={() => <FormMessage />}
                />{' '}
                {/* To show general array errors */}
                {/* --- AI Settings --- */}
                <h3 className='mt-6 flex items-center gap-2 border-b pb-2 text-lg font-medium'>
                  <BrainCircuit size={20} /> AI Settings (Optional)
                </h3>
                <FormField
                  control={form.control}
                  name='useAi'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                      <div className='space-y-0.5'>
                        <FormLabel>Use AI Assistance</FormLabel>
                        <FormDescription>
                          Enable AI features like automated responses (requires configuration).
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {form.watch('useAi') && (
                  <div className='ml-2 space-y-4 border-l pl-4'>
                    <FormField
                      control={form.control}
                      name='aiModel'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>AI Model</FormLabel>
                          <FormControl>
                            <Input placeholder='e.g., gpt-4o' {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='aiInstructions'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>AI Instructions</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder='Instructions for the AI assistant...'
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Provide context or specific instructions for the AI.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <Button type='submit' disabled={addChatWidget.isPending}>
                  {addChatWidget.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                  Create Chat Widget
                </Button>
              </CardFooter>
            </Card>
          </form>
        </Form>
      </div>
    </SettingsPage>
  )
}
